// Vitest global setup — runs before every test file.
//
// @testing-library/react mounts each render() into a shared jsdom document but
// does NOT auto-unmount when a test file ends. Without an afterEach(cleanup),
// a component rendered in one .test.tsx (e.g. threadDrawer's thread.label='wt')
// leaks into the next file's document, and a broad query like
// getByText(/wt/) in notificationHub.test.tsx then matches multiple elements
// and throws. Cleaning up after every test keeps the DOM isolated across files.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
