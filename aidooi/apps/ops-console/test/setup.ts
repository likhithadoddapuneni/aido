import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Test files run in parallel and axe is slow; waiting is cheap, a flaky failure is not.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout engine: navigation calls scrollTo, which it only logs as "not implemented".
window.scrollTo = () => undefined;
