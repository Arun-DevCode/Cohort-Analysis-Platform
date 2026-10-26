export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export class UserView {
  static render(user: any): UserDto {
    return {
      id: user.id,
      name: user.name || user.email?.split('@')[0] || 'User',
      email: user.email,
      role: user.role,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    };
  }

  static renderMany(users: any[]): UserDto[] {
    return users.map((u) => UserView.render(u));
  }
}
