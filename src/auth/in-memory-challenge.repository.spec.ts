import { InMemoryChallengeRepository } from './in-memory-challenge.repository';
import { runChallengeRepositoryContract } from './challenge-repository.contract';

describe('InMemoryChallengeRepository', () => {
  runChallengeRepositoryContract(async () => new InMemoryChallengeRepository());
});
