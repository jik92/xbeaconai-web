import { openDatabase } from "../server/db/database";
import { env } from "../server/env";

const { client } = openDatabase(env.databasePath);
client.close();

console.log(`Database migrations applied: ${env.databasePath}`);
