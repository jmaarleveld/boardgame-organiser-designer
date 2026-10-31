import type { LayoutSummary } from '../model/layout';

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function StatusBar({ summary }: { summary: LayoutSummary }) {
  const { slackX, slackY, itemCount, errorCount, warningCount } = summary;
  return (
    <footer className="statusbar" role="status">
      <span className={slackX < -1e-6 ? 'error-text' : undefined}>Slack X {f1(slackX)} mm</span>
      <span className={slackY < -1e-6 ? 'error-text' : undefined}>Slack Y {f1(slackY)} mm</span>
      <span>
        {itemCount} item{itemCount === 1 ? '' : 's'}
      </span>
      <span className={errorCount ? 'error-text' : 'ok-text'}>
        {errorCount} error{errorCount === 1 ? '' : 's'}
      </span>
      <span className={warningCount ? 'warning-text' : undefined}>
        {warningCount} warning{warningCount === 1 ? '' : 's'}
      </span>
    </footer>
  );
}
