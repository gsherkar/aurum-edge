import { Card, GLOSSARY } from '../components/ui';
export default function Glossary() {
  return (
    <Card id="glossary" title="Glossary">
      <dl className="glossary">{Object.entries(GLOSSARY).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="note">AURUM EDGE is a quantitative research and explainability tool. It does not guarantee profit and is not investment advice.</p>
    </Card>
  );
}
