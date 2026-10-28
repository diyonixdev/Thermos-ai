import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const sendChatMock = vi.hoisted(() => vi.fn())
const speakOnceMock = vi.hoisted(() =>
  vi.fn(async (_text: string, _lang?: string): Promise<string> => 'ended')
)
const cancelSpeechMock = vi.hoisted(() => vi.fn())

vi.mock('./lib/chatApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/chatApi')>()
  return { ...actual, sendChatWithRetry: sendChatMock }
})

vi.mock('./telemetry/speechController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telemetry/speechController')>()
  return {
    ...actual,
    speakOnce: speakOnceMock,
    cancelSpeech: cancelSpeechMock,
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

function renderApp() {
  return render(<App />)
}

function assistantPanel(): HTMLElement {
  const panel = document.querySelector('.assistant-panel')
  if (!panel) throw new Error('assistant panel not rendered')
  return panel as HTMLElement
}

describe('App dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    sendChatMock.mockReset()
    speakOnceMock.mockClear()
    cancelSpeechMock.mockClear()
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
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders the dashboard, telemetry and assistant panel', () => {
    renderApp()
    expect(screen.getByText(/TURBO AI/)).toBeInTheDocument()
    expect(assistantPanel()).toBeInTheDocument()
    expect(screen.getByText(/battery charge/i)).toBeInTheDocument()
  })

  it('speaks the greeting exactly once per language', async () => {
    renderApp()
    await waitFor(() => expect(speakOnceMock).toHaveBeenCalledTimes(1))
    expect(speakOnceMock.mock.calls[0][1]).toBe('en')
    // Wait past any deferred greeting re-trigger to prove there is no duplicate.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(speakOnceMock).toHaveBeenCalledTimes(1)
  })

  it('sends a typed question, renders the reply and clears the loading state', async () => {
    sendChatMock.mockResolvedValue('Charging will finish in 24 minutes.')
    const user = userEvent.setup()
    renderApp()

    const panel = assistantPanel()
    const input = within(panel).getByPlaceholderText(/./)
    await user.click(input)
    await user.keyboard('how long to charge{Enter}')

    await waitFor(() => expect(sendChatMock).toHaveBeenCalledTimes(1))
    await within(panel).findByText('Charging will finish in 24 minutes.')

    // Loading bubble must be gone — no stuck "Processing...".
    await waitFor(() =>
      expect(within(panel).queryByText(/Thinking/i)).not.toBeInTheDocument()
    )
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a retryable notice on failure instead of a fabricated answer', async () => {
    const { ChatError } = await import('./lib/chatApi')
    sendChatMock.mockRejectedValue(new ChatError('network'))
    const user = userEvent.setup()
    renderApp()

    const panel = assistantPanel()
    const input = within(panel).getByPlaceholderText(/./)
    await user.click(input)
    await user.keyboard('battery level{Enter}')

    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toBeTruthy()
    // Failure must not appear as a chat bubble with a fake local answer.
    expect(within(panel).queryByText(/local answer|AI unavailable/i)).not.toBeInTheDocument()
    // Loading must clear so the user is not stuck on Processing.
    expect(within(panel).queryByText(/Thinking/i)).not.toBeInTheDocument()

    const retryButton = within(alert).getByRole('button')
    expect(retryButton).toHaveAccessibleName(/retry/i)
  })

  it('retries the failed question and shows the answer', async () => {
    const { ChatError } = await import('./lib/chatApi')
    sendChatMock.mockRejectedValueOnce(new ChatError('timeout')).mockResolvedValueOnce('Recovered answer.')
    const user = userEvent.setup()
    renderApp()

    const panel = assistantPanel()
    const input = within(panel).getByPlaceholderText(/./)
    await user.click(input)
    await user.keyboard('rpm{Enter}')

    const alert = await within(panel).findByRole('alert')
    await user.click(within(alert).getByRole('button'))
    await within(panel).findByText('Recovered answer.')
    expect(sendChatMock).toHaveBeenCalledTimes(2)
  })

  it('drops a reply that resolves after an interrupt', async () => {
    let resolveReply: ((value: string) => void) | undefined
    sendChatMock.mockImplementation(
      () => new Promise<string>((resolve) => (resolveReply = resolve))
    )
    const user = userEvent.setup()
    renderApp()

    const panel = assistantPanel()
    const input = within(panel).getByPlaceholderText(/./)
    await user.click(input)
    await user.keyboard('slow question{Enter}')

    await waitFor(() => expect(sendChatMock).toHaveBeenCalledTimes(1))
    const interruptButton = within(panel).getByRole('button', { name: /interrupt response|रोकें/i })
    await user.click(interruptButton)

    await act(async () => {
      resolveReply?.('stale reply that must be dropped')
    })

    expect(within(panel).queryByText('stale reply that must be dropped')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/Thinking/i)).not.toBeInTheDocument()
  })

  it('opens and closes Driver Mode', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: /Driver Mode/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
