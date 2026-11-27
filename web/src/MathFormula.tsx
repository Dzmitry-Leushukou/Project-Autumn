import { renderToString } from "katex";

export default function MathFormula({
  tex,
  display = false,
}: {
  tex: string;
  display?: boolean;
}) {
  return (
    <span
      className={display ? "math-formula" : "math-symbol"}
      dangerouslySetInnerHTML={{
        __html: renderToString(tex, {
          displayMode: display,
          throwOnError: true,
          trust: false,
          strict: "error",
        }),
      }}
    />
  );
}
