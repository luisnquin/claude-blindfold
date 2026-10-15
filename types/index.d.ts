export type SecretRequest = { name: string; reason: string; toolUseId?: string }

declare module 'claude-code' {
  interface PluginState {
    blindfold: {
      secrets: Record<string, string>
      pending: SecretRequest[]
      draft: string
    }
  }
}
