import { getDb } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

export interface CreateUserData {
  name?: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'manager' | 'trainer';
}

export interface UpdateUserData {
  name?: string;
  passwordHash?: string;
  role?: 'admin' | 'manager' | 'trainer';
}

export class UserModel {
  static async findByEmail(email: string) {
    const db = getDb();
    return db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase().trim()),
    });
  }

  static async findById(id: string) {
    const db = getDb();
    return db.query.users.findFirst({
      where: eq(users.id, id),
    });
  }

  static async findAll() {
    const db = getDb();
    return db.query.users.findMany({
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    });
  }

  static async create(data: CreateUserData) {
    const db = getDb();
    const [user] = await db
      .insert(users)
      .values({
        name: data.name ? data.name.trim() : data.email.split('@')[0],
        email: data.email.toLowerCase().trim(),
        passwordHash: data.passwordHash,
        role: data.role,
      })
      .returning();
    return user;
  }

  static async update(id: string, data: UpdateUserData) {
    const db = getDb();
    const updateValues: Partial<typeof users.$inferInsert> = {};
    if (data.name !== undefined) updateValues.name = data.name.trim();
    if (data.role !== undefined) updateValues.role = data.role;
    if (data.passwordHash !== undefined) updateValues.passwordHash = data.passwordHash;

    const [user] = await db
      .update(users)
      .set(updateValues)
      .where(eq(users.id, id))
      .returning();
    return user;
  }
}
