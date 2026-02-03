// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type MockRepo<T> = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  remove: jest.Mock;
  delete: jest.Mock;
  createQueryBuilder: jest.Mock;
  manager: { query: jest.Mock };
};

export function createMockRepo<T>(): MockRepo<T> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { query: jest.fn() },
  };
}
