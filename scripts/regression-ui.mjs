import assert from 'node:assert/strict';

export async function openSettingsTab(page, name) {
  const settings = page.locator('.settings-window');
  if (!await settings.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await settings.waitFor();
  await settings.locator('.settings-navigation').getByRole('button', { name, exact: true }).click();
}
export async function closeSettings(page) {
  const settings = page.locator('.settings-window');
  await settings.locator('.ant-modal-close').click();
  await settings.waitFor({ state: 'hidden' });
}
export async function expandDebugPanel(panel) {
  await panel.waitFor();
  assert.equal(await panel.getAttribute('open'), null, 'Debug panels should start collapsed');
  await panel.locator('summary').click();
  await panel.locator('.debug-panel-fields').waitFor({ state: 'visible' });
  assert.notEqual(await panel.getAttribute('open'), null);
}
