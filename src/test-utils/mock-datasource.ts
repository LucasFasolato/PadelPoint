export type MockDataSource = {
  query: jest.Mock;
  transaction: jest.Mock;
  getRepository: jest.Mock;
};

export function createMockDataSource(): MockDataSource {
  return {
    query: jest.fn(),
    transaction: jest.fn(),
    getRepository: jest.fn(),
  };
}
