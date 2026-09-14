export async function selectMenu(page, label, value, root = page) {
  await root.getByRole('combobox', { name: label, exact: true }).click();
  const options = page.getByRole('listbox', { name: label, exact: true }).getByRole('option');
  const count = await options.count();
  for (let i = 0; i < count; i++) if (await options.nth(i).getAttribute('data-value') === value) { await options.nth(i).click(); return; }
  throw new Error(`No option ${value} in ${label}`);
}
