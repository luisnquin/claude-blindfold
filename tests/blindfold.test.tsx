import { expect, test } from 'claude-code/testing'

import { formsOf, redact, referenced, unmask } from '../hooks/redact'

const SECRET = "s3cr3t'value-123"

test('redacts the raw value and its encodings', () => {
  const all = { API_TOKEN: SECRET }
  for (const form of formsOf(SECRET)) {
    expect(redact(`before ${form} after`, all)).toBe('before [REDACTED:API_TOKEN] after')
  }
})

test('only names written as shell variables are referenced', () => {
  const names = ['API_TOKEN', 'API']
  expect(referenced('curl -H "x: $API_TOKEN"', names)).toEqual(['API_TOKEN'])
  expect(referenced('echo ${API}', names)).toEqual(['API'])
  expect(referenced('printenv', names)).toEqual([])
})

test('a stored secret reaches Bash through a file and is redacted from rows', async ($, on) => {
  const staged: string[] = []
  const ran: string[] = []

  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('env.get', () => ({ value: '/run/test' }))
  on('process.run', (_$, e) => {
    staged.push(e.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  const asked = await $.tool.call({
    tool: 'mcp__blindfold__request',
    name: 'API_TOKEN',
    reason: 'call the API',
  })
  expect(asked.deny).toBeUndefined()

  const ui = await $.ui.mount({
    plugin: 'blindfold',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'blindfold',
    props: {} as never,
  })
  expect((await ui.find({ type: 'Text', text: 'call the API' })) !== undefined).toBe(true)
  await ui.input({ key: 'value', text: SECRET.slice(0, 4), kind: 'change' })
  await ui.input({ key: 'value', text: '•'.repeat(4) + SECRET.slice(4), kind: 'change' })
  expect((await ui.find({ key: 'value' }))?.text).toBe('•'.repeat(SECRET.length))
  await ui.input({ key: 'value', text: '•'.repeat(SECRET.length) })

  await $.tool.call({ tool: 'Bash', command: 'printenv' })
  expect(staged).toHaveLength(0)

  await $.tool.call({ tool: 'Bash', command: 'curl -H "x: $API_TOKEN" x' })
  expect(staged).toEqual([`export API_TOKEN='s3cr3t'\\''value-123'\n`])
  expect(ran[1]).toMatch(/^\. '\/run\/test\/claude-blindfold\/[0-9a-f]+\.sh'; rm -f .*\ncurl -H "x: \$API_TOKEN" x$/)

  const stored = await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: `leaked ${SECRET}` }] },
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    uuid: '00000000-0000-4000-8000-000000000000',
  })
  expect(JSON.stringify(stored)).not.toContain(SECRET)
  expect(JSON.stringify(stored)).toContain('[REDACTED:API_TOKEN]')
})

test('unmask maps each mask to the next real character', () => {
  expect(unmask('••c', 'ab')).toBe('abc')
  expect(unmask('•x•', 'ab')).toBe('axb')
  expect(unmask('•', 'ab')).toBe('a')
  expect(unmask('pasted', '')).toBe('pasted')
})

test('a narrow terminal gets a button under the call and the band above the input', async ($, on) => {
  const submitted: string[] = []
  let opens = 0
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: false, reason: 'unasked below 144 columns' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>asked</Text>
  })
  on('ui.panes', () => ({ value: [{ id: 'blindfold', isPlaced: false }] as never }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  const asked = await $.tool.call({ tool: 'mcp__blindfold__request', name: 'SUDO_PASSWORD', reason: 'sudo', tool_use_id: 'toolu_1' })
  expect(JSON.stringify(asked)).toContain('enter SUDO_PASSWORD')

  const row = await $.ui.mount({
    plugin: 'blindfold',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool: 'mcp__blindfold__request', tool_use_id: 'toolu_1', output: '', isErrored: false } as never,
  })
  await row.press({ key: 'enter' })
  expect(opens).toBe(2)

  const band = await $.ui.mount({
    plugin: 'blindfold',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 60 } as never,
  })
  await band.input({ key: 'value', text: 'hunter22' })
  expect(submitted).toEqual(['blindfold: SUDO_PASSWORD is stored. Use it as $SUDO_PASSWORD in Bash.'])
})
