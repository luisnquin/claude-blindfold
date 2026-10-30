import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { SecretRequest } from '../types'
import { MASK, redact, referenced, shellQuote, unmask } from './redact'

const PANE = 'blindfold'
const TOOL = 'mcp__blindfold__request'
const NAME = /^[A-Z_][A-Z0-9_]*$/

const secrets = atom({ plugin: 'blindfold', key: 'secrets' } as const, {})
const pending = atom({ plugin: 'blindfold', key: 'pending' } as const, [])
const draft = atom({ plugin: 'blindfold', key: 'draft' } as const, '')

const INSTRUCTIONS = [
  '# Secrets (blindfold)',
  `Get every secret (sudo password, API token, passphrase) through ${TOOL}, on your own, as soon as a command needs one: sudo says "a password is required", an API answers 401, a token variable is unset.`,
  'Never suggest running the command with `!`, ask for the secret in chat, or read one from the clipboard or a file.',
  'After the call end your turn; a message says when it is stored. Use it only in Bash as a shell variable, e.g. `printf \'%s\\n\' "$SUDO_PASSWORD" | sudo -S <cmd>`. You see it as [REDACTED:NAME]; never print or transform it.',
].join('\n')


function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')
}

async function store($: EngineInterface, request: SecretRequest, value: string): Promise<void> {
  if (value.length === 0) {
    $.ui.toast(`${request.name}: empty value ignored`)
    return
  }
  await update($, secrets, all => ({ ...all, [request.name]: value }))
  await settle($, request.name)
  $.ui.toast(`${request.name} stored`)
  void $.prompt.submit({
    text: `blindfold: ${request.name} is stored. Use it as $${request.name} in Bash.`,
  })
}

async function submitDraft($: EngineInterface, request: SecretRequest, shown: string): Promise<void> {
  const value = unmask(shown, await read($, draft))
  await store($, request, value)
}

async function settle($: EngineInterface, name: string): Promise<void> {
  await update($, draft, () => '')
  const left = await update($, pending, list => list.filter(one => one.name !== name))
  if (left.length === 0) await $.ui.close({ id: PANE })
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'blindfold', focus: true, holdToasts: true, rows: 9 })
}

async function clipboard($: EngineInterface): Promise<string | undefined> {
  for (const argv of [['wl-paste', '--no-newline'], ['pbpaste'], ['xclip', '-selection', 'clipboard', '-o']]) {
    try {
      const { exitCode, stdout } = await $.process.run(argv)
      if (exitCode === 0) return stdout
    } catch {
      // ignored: a missing tool falls through to the next one
    }
  }
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'request',
      description:
        'Ask the user for a secret by name; they enter it outside the conversation and you never see it. ' +
        'End your turn after calling; once stored, use it in Bash as $NAME.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'UPPER_SNAKE variable name, e.g. GITHUB_TOKEN' },
          reason: { type: 'string', description: 'Why the secret is needed, shown to the user' },
        },
        required: ['name', 'reason'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'blindfold', description: 'Open the pending secret prompt' })
    return next(e)
  })

  on('command.run', { command: 'blindfold' }, async $ => {
    const list = await read($, pending)
    if (list.length === 0) return { text: 'No secret requested.' }
    await openPane($)
    return { text: `Secret prompt opened for ${list.map(one => one.name).join(', ')}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'blindfold', text: INSTRUCTIONS, scope: 'session' }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as { name?: unknown; reason?: unknown }
    const name = typeof input.name === 'string' ? input.name : ''
    const reason = typeof input.reason === 'string' ? input.reason : ''
    if (!NAME.test(name)) return { deny: `${name || '(empty)'} is not an UPPER_SNAKE variable name.` }

    const stored = await read($, secrets)
    if (name in stored) return { result: `${name} is already stored. Use it as $${name} in Bash.` }

    await update($, pending, list => [...list.filter(one => one.name !== name), { name, reason, toolUseId: e.tool_use_id }])
    const opened = await openPane($)
    if (!opened.isPlaced) {
      $.ui.toast(`${name} requested: tap "enter ${name}" or run /blindfold`)
      return {
        result: `Asked the user for ${name}, but the screen is too narrow for the prompt to open by itself. Tell them to tap "enter ${name}" under this call or run /blindfold, then end your turn.`,
      }
    }
    return {
      result: `Asked the user for ${name}. End your turn now; a message will say when it is stored.`,
    }
  }).catch(() => ({ deny: 'blindfold could not open the secret prompt.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const all = await read($, secrets)
    const names = referenced(e.command, Object.keys(all))
    if (names.length === 0) return next(e)

    const runtime = (await $.env.get('XDG_RUNTIME_DIR')) ?? '/tmp'
    const file = `${runtime}/claude-blindfold/${randomId()}.sh`
    const script = names.map(name => `export ${name}=${shellQuote(all[name] ?? '')}`).join('\n') + '\n'
    const { exitCode } = await $.process.run(
      ['sh', '-c', 'umask 077 && mkdir -p "${1%/*}" && cat > "$1"', 'sh', file],
      { stdin: script },
    )
    if (exitCode !== 0) return { deny: `blindfold could not stage ${names.join(', ')}.` }

    const quoted = shellQuote(file)
    return next({ ...e, command: `. ${quoted}; rm -f ${quoted}\n${e.command}` })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'blindfold failed to stage the secrets.' }))

  on('session.append', async ($, e, next) => {
    const all = await read($, secrets)
    if (Object.keys(all).length === 0) return next(e)

    const content = e.message.content.map(block => {
      if (block.type === 'text' && typeof block.text === 'string') return { ...block, text: redact(block.text, all) }
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string') return { ...block, content: redact(block.content, all) }
        if (Array.isArray(block.content)) {
          return {
            ...block,
            content: block.content.map(part => (part.type === 'text' && typeof part.text === 'string' ? { ...part, text: redact(part.text, all) } : part)),
          }
        }
      }
      return block
    })
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => (next.called ? next(e) : next({ ...e, message: { ...e.message, content: [] } })))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    if (!('Input' in ui)) return next(e)
    const { Text } = ui
    const [request] = await read($, pending)
    if (request === undefined) return <Text dimColor>No secret requested.</Text>
    return form($, ui, request)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL) return next(e)
    const request = (await read($, pending)).find(one => one.toolUseId === e.props.tool_use_id)
    if (request === undefined) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Button key="enter" label={`enter ${request.name}`} onPress={() => void openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    if (!('Input' in ui) || e.props.hasSurvey) return next(e)
    const [request] = await read($, pending)
    if (request === undefined) return next(e)
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE && pane.isPlaced)) return next(e)
    return form($, ui, request)
  })
}

async function form($: EngineInterface, ui: Pick<Elements['terminal'], 'Box' | 'Text' | 'Input' | 'Button'>, request: SecretRequest) {
  const { Box, Text, Input, Button } = ui
  const typed = await read($, draft)

  return (
    <Box flexDirection="column">
      <Text>
        The agent asks for <Text bold>{request.name}</Text>
      </Text>
      <Text dimColor>{request.reason}</Text>
      <Input
        key="value"
        label="value"
        placeholder="type or paste, Enter to store"
        value={MASK.repeat(Array.from(typed).length)}
        autoFocus
        onInput={value => void update($, draft, real => unmask(value, real))}
        onSubmit={value => void submitDraft($, request, value)}
      />
      <Box flexDirection="row" gap={8} marginTop={1}>
        <Button
          key="cancel"
          label="cancel"
          onPress={async () => {
            await settle($, request.name)
            void $.prompt.submit({ text: `blindfold: the user declined to provide ${request.name}.` })
          }}
        />
        <Button
          key="clipboard"
          plain
          label="from clipboard"
          onPress={async () => {
            const value = await clipboard($)
            if (value === undefined) $.ui.toast('clipboard is not readable')
            else await store($, request, value)
          }}
        />
      </Box>
    </Box>
  )
}
