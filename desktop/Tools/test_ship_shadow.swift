import CoreGraphics
import Foundation
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// Accept a captured frame from the packaged game, or render one in the editor.
let frame: URL
let files = FileManager.default
let scratch = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { if files.fileExists(atPath: scratch.path) { try? files.removeItem(at: scratch) } }
if let path = CommandLine.arguments.dropFirst().first {
    frame = URL(fileURLWithPath: path)
} else {
    try files.createDirectory(at: scratch, withIntermediateDirectories: true)
    let tools = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let game = Process()
    game.executableURL = URL(fileURLWithPath: "/bin/bash")
    game.arguments = [tools.appendingPathComponent("macos.sh").path, "preview", "-RenderOffscreen",
                      "-unattended", "-nosound", "-ForceRes", "-SailingHideHUD", "-SailingWeather=day",
                      "-UseFixedTimeStep", "-fps=30", "-SailingWaterView=ship-shadow",
                      "-SailingWaterFrames=" + scratch.path, "-SailingWaterFrameCount=1"]
    try game.run()
    game.waitUntilExit()
    guard game.terminationStatus == 0 else { fail("The waterline replay failed") }
    frame = scratch.appendingPathComponent("0000.png")
}

guard let source = CGImageSourceCreateWithURL(frame as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width * 5 == image.height * 8 else { fail("Expected the 16:10 waterline capture") }

let width = 768, height = 480
var pixels = [UInt8](repeating: 0, count: width * height * 4)
pixels.withUnsafeMutableBytes { buffer in
    guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
    else { fail("Could not read the captured pixels") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
}

let linear = (0...255).map { value -> Double in
    let s = Double(value) / 255
    return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
}
func medianLuminance(_ xs: Range<Int>, _ ys: Range<Int>) -> Double {
    var samples: [Double] = []
    for y in ys {
        for x in xs {
            let offset = (y * width + x) * 4
            samples.append(0.2126 * linear[Int(pixels[offset])] + 0.7152 * linear[Int(pixels[offset + 1])]
                         + 0.0722 * linear[Int(pixels[offset + 2])])
        }
    }
    samples.sort()
    return samples[samples.count / 2]
}

// Broad patches in the fixed view tolerate waves, glints and temporal reconstruction.
let sun = medianLuminance(556..<623, 348..<406)
let sail = medianLuminance(379..<441, 342..<363)
let ship = medianLuminance(493..<625, 221..<251)
let plating = medianLuminance(510..<605, 158..<176)
guard sun > 0.10, plating < 0.36 * sun else { fail("Expected sunlit water beside the dark hull") }
print(String(format: "Relative water luminance beneath sail %.2f, beside ship %.2f", sail / sun, ship / sun))
guard sail > 0.53 * sun, ship > 0.44 * sun else { fail("An opaque-looking vessel silhouette returned to the water") }
