import { _electron as electron } from 'playwright';
import { test, expect } from '@playwright/test';

test('app launches without crashing', async () => {
  const electronApp = await electron.launch({
    args: ['src/main/main.ts', 'about:blank'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const window = await electronApp.firstWindow();
  expect(window).toBeTruthy();

  await electronApp.close();
});
