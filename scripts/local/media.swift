import Foundation
import AVFoundation
import AppKit
import CoreImage

struct Frame: Decodable { let path: String; let seconds: Double }
struct Capture: Decodable {
    let revision: String; let execution: String; let width: Int; let height: Int
    let duration: Double; let frames: [Frame]
}
let capture = try JSONDecoder().decode(Capture.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let target = URL(fileURLWithPath: CommandLine.arguments[2])
let writer = try AVAssetWriter(outputURL: target, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: capture.width, AVVideoHeightKey: capture.height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1500000, AVVideoMaxKeyFrameIntervalKey: 30]])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: capture.width, kCVPixelBufferHeightKey as String: capture.height,
    kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
writer.add(input)
guard writer.startWriting() else { fatalError("Cannot start video writer") }
writer.startSession(atSourceTime: .zero)
for frame in capture.frames {
    while !input.isReadyForMoreMediaData && writer.status == .writing { Thread.sleep(forTimeInterval: 0.002) }
    guard writer.status == .writing else { fatalError("Video writer failed") }
    try autoreleasepool {
        guard let image = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: frame.path)))?.cgImage,
              image.width == capture.width, image.height == capture.height else { fatalError("Invalid frame or dimension mismatch") }
        var optional: CVPixelBuffer?
        guard let pool = adaptor.pixelBufferPool,
              CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optional) == kCVReturnSuccess,
              let pixel = optional else { fatalError("Cannot allocate video frame") }
        CVPixelBufferLockBaseAddress(pixel, [])
        defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: capture.width, height: capture.height,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { fatalError("Cannot draw frame") }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: capture.width, height: capture.height))
        if frame.seconds < 3 {
            let size = max(9, min(20, CGFloat(capture.height) / 28))
            ctx.setFillColor(CGColor(gray: 0, alpha: 0.9))
            ctx.fill(CGRect(x: 0, y: CGFloat(capture.height) - size * 3, width: CGFloat(capture.width), height: size * 3))
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
            let text = "CANDIDATE / NOT ACCEPTED | \(capture.revision)\n\(capture.execution) | live wall clock | QA not implied"
            (text as NSString).draw(in: CGRect(x: 8, y: CGFloat(capture.height) - size * 2.8,
                width: CGFloat(capture.width) - 16, height: size * 2.8),
                withAttributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.white])
            NSGraphicsContext.restoreGraphicsState()
        }
        guard adaptor.append(pixel, withPresentationTime: CMTime(seconds: frame.seconds, preferredTimescale: 1000000))
            else { fatalError("Cannot append video frame") }
    }
}
writer.endSession(atSourceTime: CMTime(seconds: capture.duration, preferredTimescale: 1000000))
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError("Video writer did not complete") }
let asset = AVURLAsset(url: target)
let reader = try AVAssetReader(asset: asset)
guard let track = asset.tracks(withMediaType: .video).first else { fatalError("No video track") }
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(output)
guard reader.startReading() else { fatalError("Cannot decode video") }
var count = 0
var maxError = 0.0
while let sample = output.copyNextSampleBuffer() {
    guard count < capture.frames.count else { fatalError("Unexpected extra decoded frame") }
    maxError = max(maxError, abs(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) - capture.frames[count].seconds))
    if count == 0 {
        guard let pixel = CMSampleBufferGetImageBuffer(sample) else { fatalError("First frame not decoded") }
        let image = CIImage(cvPixelBuffer: pixel)
        guard let cg = CIContext().createCGImage(image, from: image.extent),
              let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { fatalError("Cannot save first frame") }
        try png.write(to: URL(fileURLWithPath: target.path + ".first.png"), options: .withoutOverwriting)
    }
    count += 1
}
guard reader.status == .completed && count == capture.frames.count && maxError <= 0.001 else { fatalError("Full decode or source PTS verification failed") }
let report: [String: Any] = ["decodedFrames": count, "durationSeconds": CMTimeGetSeconds(asset.duration),
    "maxPtsErrorSeconds": maxError, "candidateLabel": "CANDIDATE / NOT ACCEPTED | \(capture.revision)"]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    .write(to: URL(fileURLWithPath: target.path + ".verification.json"), options: .withoutOverwriting)
