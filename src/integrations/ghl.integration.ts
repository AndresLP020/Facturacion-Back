/** HighLevel integration stays disabled until OAuth app credentials and signed-context settings exist. */
export class GhlIntegration {
  static enabled(): boolean {
    return (
      process.env.GHL_INTEGRATION_ENABLED === "true" &&
      Boolean(
        process.env.GHL_CLIENT_ID &&
        process.env.GHL_CLIENT_SECRET &&
        process.env.GHL_SHARED_SECRET,
      )
    );
  }
  static assertEnabled(): void {
    if (!this.enabled())
      throw new Error(
        "HighLevel integration is disabled or not fully configured",
      );
  }
}
