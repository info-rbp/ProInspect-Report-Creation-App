import { describe, expect, it } from 'vitest';
import { parseCsvRows, readSpreadsheetRows, spreadsheetRowsToRecords } from '../services/spreadsheetReader';

describe('safe spreadsheet reader', () => {
  it('turns worksheet rows into records without evaluating cell content', () => {
    expect(spreadsheetRowsToRecords([
      ['Name', 'Name', null],
      ['Example', '=HYPERLINK("https://invalid.example")', true],
    ])).toEqual([{
      Name: 'Example',
      Name_2: '=HYPERLINK("https://invalid.example")',
      column_3: true,
    }]);
  });

  it('parses quoted CSV values and rejects legacy XLS files', async () => {
    expect(spreadsheetRowsToRecords(parseCsvRows(
      'Name,Notes\r\n"Example, Pty Ltd","Line 1\nLine 2"',
    ))).toEqual([{ Name: 'Example, Pty Ltd', Notes: 'Line 1\nLine 2' }]);
    await expect(readSpreadsheetRows(new File(['legacy'], 'clients.xls')))
      .rejects.toThrow('Legacy XLS files are not accepted');
  });
});
