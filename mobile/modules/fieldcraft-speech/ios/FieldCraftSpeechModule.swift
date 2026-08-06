import AVFoundation
import ExpoModulesCore
import Speech
import UIKit

struct FieldCraftSpeechOptions: Record {
  @Field var locale: String = "en-US"
  @Field var maxDurationMs: Int = 120_000
}

public final class FieldCraftSpeechModule: Module {
  private let audioEngine = AVAudioEngine()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var timeoutWorkItem: DispatchWorkItem?
  private var backgroundObserver: NSObjectProtocol?
  private var audioTapInstalled = false
  private var recording = false
  private var transcript = ""

  public func definition() -> ModuleDefinition {
    Name("FieldCraftSpeech")
    Events("onTranscript", "onSpeechError")

    OnCreate {
      self.backgroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self, self.recording else { return }
        self.sendEvent("onSpeechError", ["code": "RECOGNITION_FAILED"])
        self.cleanup(cancelTask: true)
      }
    }

    OnDestroy {
      if let observer = self.backgroundObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.cleanup(cancelTask: true)
    }

    AsyncFunction("availability") { () -> String in
      switch SFSpeechRecognizer.authorizationStatus() {
      case .denied, .restricted:
        return "permission-denied"
      default:
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        return recognizer?.supportsOnDeviceRecognition == true ? "available" : "manual-only"
      }
    }.runOnQueue(.main)

    AsyncFunction("start") { (options: FieldCraftSpeechOptions, promise: Promise) in
      guard !self.recording else {
        promise.reject(self.error("ALREADY_RECORDING", "A speech recording is already active."))
        return
      }
      guard options.maxDurationMs == 120_000 else {
        promise.reject(self.error("RECOGNITION_FAILED", "The speech duration contract is invalid."))
        return
      }
      self.authorizeAndStart(options: options, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("stop") { (promise: Promise) in
      guard self.recording else {
        promise.reject(self.error("NOT_RECORDING", "No speech recording is active."))
        return
      }
      let finalTranscript = self.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
      self.cleanup(cancelTask: false)
      guard !finalTranscript.isEmpty else {
        promise.reject(self.error("NO_SPEECH", "No speech was recognized."))
        return
      }
      promise.resolve(["transcript": finalTranscript])
    }.runOnQueue(.main)

    AsyncFunction("cancel") {
      self.cleanup(cancelTask: true)
    }.runOnQueue(.main)
  }

  private func authorizeAndStart(options: FieldCraftSpeechOptions, promise: Promise) {
    SFSpeechRecognizer.requestAuthorization { [weak self] speechStatus in
      DispatchQueue.main.async {
        guard let self else { return }
        guard speechStatus == .authorized else {
          promise.reject(self.error("PERMISSION_DENIED", "Speech recognition permission is required."))
          return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          DispatchQueue.main.async {
            guard granted else {
              promise.reject(self.error("PERMISSION_DENIED", "Microphone permission is required."))
              return
            }
            self.beginRecognition(options: options, promise: promise)
          }
        }
      }
    }
  }

  private func beginRecognition(options: FieldCraftSpeechOptions, promise: Promise) {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: options.locale)),
          recognizer.isAvailable,
          recognizer.supportsOnDeviceRecognition else {
      promise.reject(error("ON_DEVICE_UNAVAILABLE", "On-device speech recognition is unavailable."))
      return
    }
    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true
      request.requiresOnDeviceRecognition = true
      recognitionRequest = request
      transcript = ""

      let inputNode = audioEngine.inputNode
      let format = inputNode.outputFormat(forBus: 0)
      inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
      }
      audioTapInstalled = true
      audioEngine.prepare()
      try audioEngine.start()
      recording = true

      recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, recognitionError in
        DispatchQueue.main.async {
          guard let self else { return }
          if let result {
            self.transcript = result.bestTranscription.formattedString
            self.sendEvent("onTranscript", ["transcript": self.transcript, "isFinal": result.isFinal])
            if result.isFinal { self.cleanup(cancelTask: false) }
          } else if recognitionError != nil && self.recording {
            self.sendEvent("onSpeechError", ["code": "RECOGNITION_FAILED"])
            self.cleanup(cancelTask: true)
          }
        }
      }

      let timeout = DispatchWorkItem { [weak self] in
        guard let self, self.recording else { return }
        self.sendEvent("onSpeechError", ["code": "TIMEOUT"])
        self.cleanup(cancelTask: true)
      }
      timeoutWorkItem = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 120.0, execute: timeout)
      promise.resolve(nil)
    } catch {
      cleanup(cancelTask: true)
      promise.reject(self.error("RECOGNITION_FAILED", "On-device speech recognition failed."))
    }
  }

  private func cleanup(cancelTask: Bool) {
    timeoutWorkItem?.cancel()
    timeoutWorkItem = nil
    if audioEngine.isRunning { audioEngine.stop() }
    if audioTapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      audioTapInstalled = false
    }
    recognitionRequest?.endAudio()
    if cancelTask { recognitionTask?.cancel() }
    recognitionTask = nil
    recognitionRequest = nil
    recording = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func error(_ code: String, _ message: String) -> Exception {
    Exception(name: "FieldCraftSpeechError", description: message, code: code)
  }
}
