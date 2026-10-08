import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The first render in a file pays for module loading; under load that exceeds the 1 s default.
configure({ asyncUtilTimeout: 4000 });
