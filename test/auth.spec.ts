describe('security defaults', () => {
  it('keeps real GHL integration disabled without explicit complete configuration', async () => {
    const { GhlIntegration } = await import('../src/integrations/ghl.integration');
    const old = { enabled: process.env.GHL_INTEGRATION_ENABLED, client: process.env.GHL_CLIENT_ID, secret: process.env.GHL_CLIENT_SECRET, shared: process.env.GHL_SHARED_SECRET };
    delete process.env.GHL_INTEGRATION_ENABLED; delete process.env.GHL_CLIENT_ID; delete process.env.GHL_CLIENT_SECRET; delete process.env.GHL_SHARED_SECRET;
    expect(GhlIntegration.enabled()).toBe(false);
    Object.entries({ GHL_INTEGRATION_ENABLED: old.enabled, GHL_CLIENT_ID: old.client, GHL_CLIENT_SECRET: old.secret, GHL_SHARED_SECRET: old.shared }).forEach(([key, value])=>{if(value===undefined)delete process.env[key];else process.env[key]=value;});
  });
  it('does not invent an official INVOGO endpoint when real adapter is selected', async () => {
    const { RealInvogoProvider } = await import('../src/integrations/billing-provider');
    delete process.env.INVOGO_API_BASE_URL; delete process.env.INVOGO_API_KEY;
    expect(()=>new RealInvogoProvider()).toThrow(/official API contract/);
  });
});
