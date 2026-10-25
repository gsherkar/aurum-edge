declare module 'plotly.js-basic-dist-min' {
  const Plotly: {
    react: (el: HTMLElement, data: unknown[], layout?: object, config?: object) => Promise<unknown>;
    purge: (el: HTMLElement) => void;
  };
  export default Plotly;
}
