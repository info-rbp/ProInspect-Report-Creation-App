import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LoginPage from '../components/LoginPage';

describe('production login security', () => {
  it('renders blank credentials without public registration or credential presets', () => {
    const markup = renderToStaticMarkup(<LoginPage onLogin={async () => undefined} />);

    expect(markup).toContain('value=""');
    expect(markup).not.toContain('Create Account');
    expect(markup).not.toContain('Quick Account Presets');
    expect(markup).not.toContain('Register &amp; Launch');
  });
});
