// LazyMotion feature bundle, code-split out of the main chunk.
// `CaptureProvider` loads this on demand via `() => import('./motion-features')`
// so the core `m` runtime stays ~5kb and the DOM animation features are only
// fetched when the capture animation actually runs.
import { domAnimation } from 'motion/react';

export default domAnimation;
