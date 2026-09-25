/** The test dependency exposes the same Clipper API provided globally by Foundry. */
declare module 'clipper-lib' {
    const clipper: typeof ClipperLib;
    export default clipper;
}
