import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverModePanel } from './DriverMode'
import { LanguageProvider } from './i18n/LanguageContext'
import { TelemetryProvider } from './telemetry/useTelemetry'

const sendChatMock = vi.hoisted(() => vi.fn())
const speakOnceMock = vi.hoisted(() =>
  vi.fn(async (_text: string, _lang?: string): Promise<string> => 'ended')
)

vi.mock('./lib/chatApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/chatApi')>()
  return { ...actual, sendChatWithRetry: sendChatMock }
})

vi.mock('./telemetry/speechController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telemetry/speechController')>()
  return {
    ...actual,
    speakOnce: speakOnceMock,
    isVoiceOutputEnabled: () => true,
  }
})

class FakeRecognition {
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
}

function renderDriver(onClose = vi.fn()) {
  return render(
    <LanguageProvider>
      <TelemetryProvider>
        <DriverModePanel onClose={onClose} volume={70} />
      </TelemetryProvider>
    </LanguageProvider>
  )
}

describe('DriverModePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    sendChatMock.mockReset()
    speakOnceMock.mockClear()
    Object.defineProperty(window, 'SpeechRecognition', {
      value: FakeRecognition,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: FakeRecognition,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true })
  })

  it('renders the driver panel with telemetry and instructions', () => {
    renderDriver()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Turbo AI — Driver Assistant/)).toBeInTheDocument()
    expect(screen.getByText(/Battery Charge/)).toBeInTheDocument()
    expect(screen.getByText(/Exhaust Temp/)).toBeInTheDocument()
  })

  it('submits on Enter, clears the input and shows the reply', async () => {
    sendChatMock.mockResolvedValue('Battery is at 72 percent.')
    const user = userEvent.setup()
    renderDriver()

    const input = screen.getByPlaceholderText(/Type your question/i)
    await user.click(input)
    await user.keyboard('how much battery{Enter}')

    expect(input).toHaveValue('')
    await waitFor(() => expect(sendChatMock).toHaveBeenCalledTimes(1))
    await screen.findByText('Battery is at 72 percent.')
  })

  it('ignores an empty or whitespace-only question', async () => {
    sendChatMock.mockResolvedValue('x')
    const user = userEvent.setup()
    renderDriver()

    const input = screen.getByPlaceholderText(/Type your question/i)
    await user.click(input)
    await user.keyboard('   {Enter}')

    expect(sendChatMock).not.toHaveBeenCalled()
  })

  it('never fabricates a local answer when the request fails', async () => {
    const { ChatError } = await import('./lib/chatApi')
    sendChatMock.mockRejectedValue(new ChatError('network'))
    const user = userEvent.setup()
    renderDriver()

    const input = screen.getByPlaceholderText(/Type your question/i)
    await user.click(input)
    await user.keyboard('what is rpm{Enter}')

    await waitFor(() => expect(sendChatMock).toHaveBeenCalledTimes(1))
    await screen.findByRole('alert')

    // The failure must surface as a retryable notice, not a chat bubble
    // claiming a local/telemetry answer was produced.
    const bubbles = screen.queryAllByText(/local answer|AI unavailable/i)
    expect(bubbles).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toMatch(/./)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('retries via the notice button after a failure', async () => {
    const { ChatError } = await import('./lib/chatApi')
    sendChatMock.mockRejectedValueOnce(new ChatError('timeout')).mockResolvedValueOnce('Recovered.')
    const user = userEvent.setup()
    renderDriver()

    const input = screen.getByPlaceholderText(/Type your question/i)
    await user.click(input)
    await user.keyboard('battery time{Enter}')

    const retryButton = await screen.findByRole('button', { name: /retry/i })
    await user.click(retryButton)

    await screen.findByText('Recovered.')
    expect(sendChatMock).toHaveBeenCalledTimes(2)
  })

  it('closes the panel via the close button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderDriver(onClose)

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
