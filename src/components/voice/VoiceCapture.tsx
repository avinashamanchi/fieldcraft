import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Type, Loader2, AlertCircle } from 'lucide-react'
import Button from '../ui/Button'

interface VoiceCaptureProps {
  onTranscript: (transcript: string) => void
  isProcessing: boolean
}

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionError extends Event {
  error: string
}

interface ISpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionError) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition
    webkitSpeechRecognition?: new () => ISpeechRecognition
  }
}

const hasSpeechAPI = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

export default function VoiceCapture({ onTranscript, isProcessing }: VoiceCaptureProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [textInput, setTextInput] = useState('')
  const [useTextFallback, setUseTextFallback] = useState(!hasSpeechAPI())
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const accumulatedRef = useRef('')

  const startRecording = useCallback(() => {
    if (!hasSpeechAPI()) {
      setUseTextFallback(true)
      return
    }

    setError(null)
    setInterimText('')
    accumulatedRef.current = ''

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition!()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          accumulatedRef.current += result[0].transcript + ' '
        } else {
          interim = result[0].transcript
        }
      }
      setFinalText(accumulatedRef.current)
      setInterimText(interim)
    }

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Enable it in browser settings or type below.')
        setUseTextFallback(true)
      } else if (event.error !== 'no-speech') {
        setError('Voice capture error. Try again or type below.')
      }
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop()
    setIsRecording(false)
  }, [])

  const handleSubmitVoice = () => {
    const transcript = (accumulatedRef.current + ' ' + interimText).trim()
    if (transcript.length > 5) {
      onTranscript(transcript)
    }
  }

  const handleSubmitText = () => {
    if (textInput.trim().length > 10) {
      onTranscript(textInput.trim())
    }
  }

  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  if (useTextFallback) {
    return (
      <div className="space-y-4">
        {!hasSpeechAPI() && (
          <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <AlertCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-300">
              Voice not supported in this browser — type your job description below.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            What did you work on today?
          </label>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="e.g. Replaced water heater at Johnson house, 3 hours labor, new 50-gallon Rheem unit, two pipe fittings, shut-off valve..."
            className="w-full bg-[#2A2A2A] border border-white/10 rounded-xl p-4 text-warm-white placeholder-gray-500 text-sm leading-relaxed min-h-[140px] focus:outline-none focus:border-orange-500 resize-none"
            autoFocus
          />
          <p className="text-xs text-gray-500 mt-1">{textInput.length} characters</p>
        </div>

        <div className="flex gap-3">
          {hasSpeechAPI() && (
            <Button variant="ghost" size="sm" onClick={() => setUseTextFallback(false)} className="flex-shrink-0">
              <Mic size={15} />
              Use Voice
            </Button>
          )}
          <Button
            fullWidth
            onClick={handleSubmitText}
            disabled={textInput.trim().length < 10}
            loading={isProcessing}
          >
            {isProcessing ? 'Generating Invoice...' : 'Generate Invoice'}
          </Button>
        </div>
      </div>
    )
  }

  const displayText = finalText + interimText
  const hasText = displayText.trim().length > 5

  return (
    <div className="space-y-6">
      {/* Mic button */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          {/* Pulse rings when recording */}
          {isRecording && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full bg-orange-500/20"
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-orange-500/15"
                animate={{ scale: [1, 2], opacity: [0.4, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.3 }}
              />
            </>
          )}

          <motion.button
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={isRecording ? stopRecording : undefined}
            className={`
              relative w-24 h-24 rounded-full flex items-center justify-center transition-colors cursor-pointer
              focus:outline-none focus:ring-4 focus:ring-orange-500/40
              ${isRecording
                ? 'bg-orange-500 shadow-lg shadow-orange-500/30'
                : 'bg-[#2A2A2A] border-2 border-white/10 hover:border-orange-500/50 hover:bg-[#333]'
              }
            `}
            whileTap={{ scale: 0.95 }}
            aria-label={isRecording ? 'Recording — release to process' : 'Hold to record'}
          >
            <AnimatePresence mode="wait">
              {isRecording ? (
                <motion.div key="recording" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                  <MicOff size={32} className="text-white" />
                </motion.div>
              ) : (
                <motion.div key="idle" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                  <Mic size={32} className="text-orange-400" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        <p className="text-sm text-gray-400 text-center">
          {isRecording ? (
            <span className="text-orange-300 font-medium">Listening... release when done</span>
          ) : isProcessing ? (
            <span className="text-orange-300 font-medium flex items-center gap-2 justify-center">
              <Loader2 size={14} className="animate-spin" /> Building your invoice...
            </span>
          ) : hasText ? (
            'Hold again to add more, or tap Generate'
          ) : (
            'Hold the button and describe your job'
          )}
        </p>
      </div>

      {/* Live transcript */}
      <AnimatePresence>
        {displayText && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-[#2A2A2A] border border-white/10 rounded-xl p-4 min-h-[80px]"
          >
            <p className="text-sm text-gray-400 mb-1 font-medium">What you said:</p>
            <p className="text-warm-white text-sm leading-relaxed">
              {finalText}
              {interimText && <span className="text-gray-400">{interimText}</span>}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="ghost" size="sm" onClick={() => setUseTextFallback(true)} className="flex-shrink-0">
          <Type size={15} />
          Type
        </Button>

        {hasText && !isRecording && (
          <Button fullWidth onClick={handleSubmitVoice} loading={isProcessing}>
            {isProcessing ? 'Generating Invoice...' : 'Generate Invoice'}
          </Button>
        )}
      </div>
    </div>
  )
}
