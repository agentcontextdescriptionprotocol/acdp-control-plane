/**
 * Reference `finance` domain pack — concrete example exercising every
 * surface of the `DomainPack` contract so reviewers can see the
 * intended shape.
 *
 * Not intended as a production-ready vocabulary; the synonyms and
 * stop-words are illustrative. Real finance packs land when a finance
 * customer drives the requirements.
 */
import { DomainPack } from './domain-pack';

export const FINANCE_PACK: DomainPack = {
  id: 'finance',
  version: '0.1.0',
  label: 'Finance (reference)',
  agentTemplates: [
    {
      id: 'finance.publisher',
      description:
        'Publishes structured financial snapshots — earnings, balance-sheet entries, ' +
        'analyst commentary.',
      capabilities: ['urn:acdp:cap:publish:data_snapshot:finance'],
    },
    {
      id: 'finance.researcher',
      description: 'Retrieves and synthesizes finance contexts; produces analysis documents.',
      capabilities: [
        'urn:acdp:cap:retrieve:data_snapshot:finance',
        'urn:acdp:cap:publish:analysis:finance',
      ],
    },
  ],
  contextTypes: [
    {
      contextType: 'earnings_report',
      requiredFields: ['fiscal_quarter', 'ticker', 'currency'],
      defaultVisibility: 'restricted',
    },
    {
      contextType: 'analyst_note',
      requiredFields: ['ticker', 'rating'],
      defaultVisibility: 'restricted',
    },
  ],
  searchVocab: {
    synonyms: {
      eps: 'earnings_per_share',
      ebit: 'operating_income',
      capex: 'capital_expenditure',
      ttm: 'trailing_twelve_months',
    },
    stopWords: ['q1', 'q2', 'q3', 'q4', 'fy'],
  },
};
