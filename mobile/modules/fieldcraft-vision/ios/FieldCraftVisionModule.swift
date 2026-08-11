import ExpoModulesCore
import ImageIO
import Vision

public final class FieldCraftVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FieldCraftVision")

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try self.recognize(uri: uri)
          promise.resolve(result)
        } catch {
          promise.reject(error)
        }
      }
    }
  }

  private func recognize(uri: String) throws -> [String: Any] {
    guard let url = URL(string: uri), url.isFileURL else {
      throw error("FILE_NOT_LOCAL", "Receipt OCR accepts only a local file URL.")
    }
    let resources = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard resources.isRegularFile == true, let fileSize = resources.fileSize else {
      throw error("IMAGE_UNREADABLE", "The receipt image is unreadable.")
    }
    guard fileSize <= 12 * 1024 * 1024 else {
      throw error("FILE_TOO_LARGE", "The receipt image is larger than 12 MiB.")
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
      throw error("IMAGE_UNREADABLE", "The receipt image could not be decoded.")
    }
    let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
    let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
    guard width > 0, height > 0, width <= 4096, height <= 4096 else {
      throw error("IMAGE_UNREADABLE", "The decoded receipt dimensions are invalid.")
    }
    let rawOrientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    do {
      try handler.perform([request])
    } catch {
      throw self.error("OCR_FAILED", "Vision could not recognize this receipt.")
    }
    guard let raw = request.results else {
      throw error("OCR_UNAVAILABLE", "Vision receipt recognition is unavailable.")
    }
    let ordered = raw.sorted { left, right in
      let leftY = left.boundingBox.midY
      let rightY = right.boundingBox.midY
      if abs(leftY - rightY) > 0.02 { return leftY > rightY }
      return left.boundingBox.minX < right.boundingBox.minX
    }
    let observations: [[String: Any]] = ordered.compactMap { observation in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      return [
        "text": candidate.string,
        "confidence": Double(candidate.confidence),
        "x": Double(observation.boundingBox.minX),
        "y": Double(observation.boundingBox.midY),
      ]
    }
    let text = observations.compactMap { $0["text"] as? String }.joined(separator: "\n")
    guard text.count <= 30_000 else {
      throw error("TEXT_TOO_LARGE", "Recognized receipt text is too large.")
    }
    let confidences = observations.compactMap { $0["confidence"] as? Double }
    let confidence = confidences.isEmpty ? 0 : confidences.reduce(0, +) / Double(confidences.count)
    return ["text": text, "confidence": confidence, "observations": observations]
  }

  private func error(_ code: String, _ message: String) -> Exception {
    Exception(name: "FieldCraftVisionError", description: message, code: code)
  }
}
