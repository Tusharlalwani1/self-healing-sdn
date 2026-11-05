import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from '../src/pages/LandingPage';
import { Metric, Status } from '../src/components/ui/Primitives';
import { NetworkIllustration } from '../src/components/landing/NetworkIllustration';

test('motion-enabled landing remains readable before effects and exposes real navigation links', () => {
  const html = renderToStaticMarkup(<LandingPage/>);
  for (const text of ['Networks fail.', 'Build a way', 'forward.', 'Monitor', 'Detect', 'Recover', 'Analyze', 'Baseline', 'Reactive', 'Fast Failover']) assert.ok(html.includes(text));
  assert.match(html,/href="#approach"/);
  assert.match(html,/href="#strategies"/);
  assert.match(html,/href="\/dashboard"/);
  assert.doesNotMatch(html,/opacity:\s*0[;"}]|visibility:\s*hidden|aria-hidden="true"[^>]*>Networks/);
});

test('illustrative recovery is explicitly separate from operational telemetry', () => {
  const html = renderToStaticMarkup(<NetworkIllustration/>);
  assert.match(html,/Illustration · not live telemetry/);
  assert.match(html,/LINK DOWN/);
  assert.match(html,/PATH RECOVERED/);
  assert.match(html,/not a live measurement/);
  assert.match(html,/aria-hidden="true"/); // looping captions are not repeated announcements
  assert.doesNotMatch(html,/aria-live|[0-9]+\.[0-9]+ ms|packets received/);
});

test('metric and status animation preserves exact zero, unavailable and failure text', () => {
  for (const value of [0, 'N/A', '300 / 97', '67.67%']) {
    const html = renderToStaticMarkup(<dl><Metric label="Actual measurement" value={value}/></dl>);
    assert.match(html,/<dd[^>]*>/);
    assert.ok(html.includes(`>${value}</dd>`));
  }
  const html = renderToStaticMarkup(<Status tone="bad">CONTROLLER FAILED</Status>);
  assert.match(html,/CONTROLLER FAILED/);
  assert.doesNotMatch(html,/RUNNING|RECOVERED/);
});
