import { InMemoryRevocationRepository } from './in-memory-revocation.repository';
import { runRevocationRepositoryContract } from './revocation-repository.contract';

describe('InMemoryRevocationRepository', () => {
  runRevocationRepositoryContract(async () => new InMemoryRevocationRepository());
});
