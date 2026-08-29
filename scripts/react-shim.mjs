/**
 * Enough of React for a script.
 *
 * `lib/` memoises per-request reads with React's `cache()`, which Node cannot
 * import from React's CommonJS build as a named export. A script has no render
 * and no request, so there is nothing to memoise across — identity is the
 * honest implementation, not a stub that pretends.
 *
 * The one consequence worth knowing: a script calling the same cached function
 * twice really does hit the database twice.
 */
export const cache = (fn) => fn;

const shim = { cache };
export default shim;
