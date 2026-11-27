import { memo } from "react";
import "katex/dist/katex.min.css";
import { mathModels } from "./mathCatalog";
import type { Network } from "./model";
import MathFormula from "./MathFormula";
import DistributionPlots from "./DistributionPlots";
import "./mathModels.css";

export default memo(function MathModels({ network }: { network: Network }) {
  return (
    <main className="workspace math-models" aria-label="Математические модели">
      <div className="page-heading">
        <h1>Математические модели</h1>
      </div>
      <div className="math-layout">
        <nav className="math-index" aria-label="Оглавление моделей">
          {mathModels.map((model, index) => (
            <a key={model.id} href={`#math-${model.id}`}>
              {index + 1}. {model.title}
            </a>
          ))}
        </nav>
        <div className="math-cards">
          {mathModels.map((model, index) => (
            <article
              className="panel math-card"
              id={`math-${model.id}`}
              key={model.id}
              aria-labelledby={`math-title-${model.id}`}
            >
              <h2 id={`math-title-${model.id}`}>
                {index + 1}. {model.title}
              </h2>
              <div className="math-formulas" aria-label="Формулы">
                {model.formulas.map((tex) => (
                  <MathFormula key={tex} tex={tex} display />
                ))}
              </div>
              <dl
                className="math-variables"
                aria-label="Обозначения переменных"
              >
                {model.variables.map(([symbol, description]) => (
                  <div key={symbol}>
                    <dt>
                      <MathFormula tex={symbol} />
                    </dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
              <p className="math-usage">
                <b>Использование</b>
                {model.usage}
              </p>
              <DistributionPlots model={model.id} network={network} />
            </article>
          ))}
        </div>
      </div>
    </main>
  );
});
