# Claude Blindfold

A Claude Code mod that lets the agent use your secrets without seeing them. It asks for a password or token by name, you type it outside the conversation, and Bash commands that name `$NAME` get the value while the transcript only ever shows `[REDACTED:NAME]`.

[![License](https://img.shields.io/github/license/luisnquin/claude-blindfold)](LICENSE)
[![Stars](https://img.shields.io/github/stars/luisnquin/claude-blindfold)](https://github.com/luisnquin/claude-blindfold/stargazers)

Inspired by [vimtor's opencode-blindfold](https://x.com/vimtor/status/2110032239199166899).

## Install

Inside Claude Code, run:

```
/plugin marketplace add luisnquin/claude-blindfold
/plugin install blindfold
/reload-plugins
```

<details>
<summary><strong>Prefer the terminal?</strong></summary>

```bash
claude plugin marketplace add luisnquin/claude-blindfold
claude plugin install blindfold@claude-blindfold
```

Then run `/reload-plugins` inside a session, or start a new one.

</details>

## What You See

Ask for something that needs a secret, such as `run sudo ls`. When sudo says it needs a password, the agent asks blindfold for `SUDO_PASSWORD` and ends its turn:

```
● blindfold - request (MCP)(name: "SUDO_PASSWORD", reason: "sudo needs a password to run ls")
  ⎿ Asked the user for SUDO_PASSWORD. End your turn now; a message will say when it is stored.

╭ blindfold ──────────────────────────────────────╮
│ The agent asks for SUDO_PASSWORD                │
│ sudo needs a password to run ls                 │
│ value ••••••••••                                │
│ [cancel]  from clipboard                        │
╰─────────────────────────────────────────────────╯
```

- **Type or paste it.** The field shows one `•` per character. Enter stores it, `cancel` tells the agent you declined, and `from clipboard` reads the clipboard as a last resort.
- **The agent picks up by itself.** Once the value is stored, blindfold sends `blindfold: SUDO_PASSWORD is stored` as a prompt, and the agent runs `printf '%s\n' "$SUDO_PASSWORD" | sudo -S ls`.
- **Works on narrow screens.** Claude Code only opens a pane by itself on terminals at least 144 columns wide. On a narrower one (a phone, a split), tap `enter SUDO_PASSWORD` under the request, or run `/blindfold`. A pane you open yourself fits any width. If no other mod uses the band above the prompt, the field shows there too.
- **Asked once per session.** The agent reuses a stored name for the rest of the session.

## How It Works

Claude Blindfold is a [mod](https://code.claude.com/docs/en/plugins/mods/overview):

1. It adds a short section to the system prompt and registers the `mcp__blindfold__request` tool. The section tells the agent to call the tool on its own whenever a command needs a secret (sudo saying "a password is required", an API answering 401, a token variable being unset), instead of suggesting `! <command>` or asking you to paste the value into the chat.
2. The tool returns at once and opens the prompt. The value you enter is kept in the session's plugin state, never in a message.
3. Before each Bash call, it checks the command for `$NAME` or `${NAME}`. For each name it finds, it writes `export NAME='value'` to a file only you can read in `$XDG_RUNTIME_DIR/claude-blindfold/` (or `/tmp`), and prefixes the command so the shell sources and deletes that file first. The command the agent wrote, and the one shown in the transcript, keep only `$NAME`. Commands that don't name a secret get nothing.
4. Every row written to the transcript passes through it first. Text and tool results have the value replaced with `[REDACTED:NAME]`, along with its common encodings for values of 8 or more characters: JSON-escaped, URL-encoded, base64 (padded, unpadded and URL-safe) and hex.

## Security

Blindfold keeps secrets out of the conversation, the transcript and the model's context, so a password doesn't end up in a log or a prompt by accident. It is not a sandbox against an agent that sets out to leak one:

- **Any command that names a secret gets it,** for the rest of the session, with no further approval.
- **Redaction only matches the forms listed above.** A command that reverses, splits or re-encodes the value some other way prints it unredacted.
- **The value lives in Claude Code's session state** until the session ends.

The mod makes no network requests. It runs `sh` to write the per-command file, and `wl-paste`, `pbpaste` or `xclip` only when you press `from clipboard`. It reads `XDG_RUNTIME_DIR`.

Run `claude plugin validate` on the repo to see every event it hooks and every call it makes.

## Requirements

- Claude Code with mods support. Developed and tested on v2.1.300.
- macOS or Linux. Commands are prefixed for a POSIX shell, so native Windows doesn't work.

## Troubleshooting

**The agent tells me to run the command with `!`.** The mod isn't loaded in that session. Run `/plugin` and check that `blindfold` is listed as an active mod, then start a new session. A session that was open before the install doesn't have the system prompt section.

**No prompt appeared.** Your terminal is under 144 columns. Tap `enter NAME` under the request, or run `/blindfold`.

**The field above the prompt never shows.** Another mod draws in that band and doesn't pass it on (for example [prompt-rail](https://github.com/oikon48/prompt-rail) once you have sent a prompt). Use the button or `/blindfold`.

## Development

```bash
git clone https://github.com/luisnquin/claude-blindfold
cd claude-blindfold

# Load it for one session without installing
claude --plugin-dir .

# Check it and run the tests
claude plugin validate .
claude plugin test .
```

Claude Code writes the API types into `.claude-plugin/types/` the first time it loads the mod, and `tsc -p .` type-checks it from then on.

## License

MIT. See [LICENSE](LICENSE).
