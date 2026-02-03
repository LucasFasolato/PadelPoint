export type MockDataSource = {
  query: jest.Mock;
  transaction: jest.Mock;
};

export function createMockDataSource(): MockDataSource {
  return {
    query: jest.fn(),
    transaction: jest.fn(),
  };
}
