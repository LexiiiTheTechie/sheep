use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::{params, Connection, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserSession {
    pub id: String,
    pub user_id: String,
    pub device: String,
    pub ip: String,
    pub last_active: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chat {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub edited_at: Option<String>,
    pub position: i64,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;

        // Pragmas for fast, crash-resilient local SQLite
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;"
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device TEXT NOT NULL,
                ip TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_active TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            
            INSERT OR IGNORE INTO system_config (key, value) VALUES ('max_active_users', '3');

            CREATE TABLE IF NOT EXISTS chats (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title       TEXT NOT NULL DEFAULT 'New Conversation',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                edited_at   TEXT,
                position    INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chats_user    ON chats(user_id, updated_at);
            CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, position);"
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chats (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title       TEXT NOT NULL DEFAULT 'New Conversation',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                edited_at   TEXT,
                position    INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chats_user    ON chats(user_id, updated_at);
            CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, position);"
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // Config: max_active_users
    pub fn get_max_active_users(&self) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        let val: String = conn.query_row(
            "SELECT value FROM system_config WHERE key = 'max_active_users'",
            [],
            |r| r.get(0),
        ).unwrap_or_else(|_| "3".to_string());
        Ok(val.parse::<u32>().unwrap_or(3))
    }

    pub fn set_max_active_users(&self, limit: u32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO system_config (key, value) VALUES ('max_active_users', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![limit.to_string()],
        )?;
        Ok(())
    }

    // User check: count existing users (first-run check)
    pub fn count_users(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        Ok(count as usize)
    }

    // Register / First-run Setup
    pub fn create_user(&self, username: &str, password: &str, role: &str) -> Result<UserProfile, String> {
        let trimmed_user = username.trim();
        if trimmed_user.len() < 2 {
            return Err("Username must be at least 2 characters long.".into());
        }
        if password.len() < 6 {
            return Err("Password must be at least 6 characters long.".into());
        }

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Password hashing failed: {e}"))?
            .to_string();

        let id = format!("usr_{}", Uuid::now_v7().simple());
        let created_at = Utc::now().to_rfc3339();

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![&id, trimmed_user, &password_hash, role, &created_at],
        ).map_err(|e| format!("Database error: {e}"))?;

        Ok(UserProfile {
            id,
            username: trimmed_user.to_string(),
            role: role.to_string(),
            created_at,
        })
    }

    // Authenticate user & create session
    pub fn login(&self, username: &str, password: &str, device: &str, ip: &str) -> Result<(UserProfile, String), String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?1")
            .map_err(|e| e.to_string())?;

        let user_row = stmt.query_row(params![username.trim()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        });

        let (id, db_username, db_hash, role, created_at) = match user_row {
            Ok(data) => data,
            Err(_) => return Err("Invalid username or password.".into()),
        };

        // Verify password
        let parsed_hash = PasswordHash::new(&db_hash).map_err(|e| e.to_string())?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .map_err(|_| "Invalid username or password.".to_string())?;

        // Create new session token
        let session_id = format!("sess_{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO sessions (id, user_id, device, ip, created_at, last_active) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![&session_id, &id, device, ip, &now],
        ).map_err(|e| e.to_string())?;

        let profile = UserProfile {
            id,
            username: db_username,
            role,
            created_at,
        };

        Ok((profile, session_id))
    }

    // Validate active session
    pub fn get_session_user(&self, session_id: &str) -> Option<UserProfile> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT u.id, u.username, u.role, u.created_at
             FROM users u
             INNER JOIN sessions s ON s.user_id = u.id
             WHERE s.id = ?1"
        ).ok()?;

        stmt.query_row(params![session_id], |row| {
            Ok(UserProfile {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
                created_at: row.get(3)?,
            })
        }).ok()
    }

    // Logout session
    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(())
    }

    // List user sessions
    pub fn get_user_sessions(&self, user_id: &str, current_session_id: &str) -> Result<Vec<UserSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, device, ip, last_active FROM sessions WHERE user_id = ?1"
        )?;

        let rows = stmt.query_map(params![user_id], |row| {
            let id: String = row.get(0)?;
            let is_current = id == current_session_id;
            Ok(UserSession {
                id,
                user_id: row.get(1)?,
                device: row.get(2)?,
                ip: row.get(3)?,
                last_active: row.get(4)?,
                is_current,
            })
        })?;

        let mut sessions = Vec::new();
        for s in rows {
            if let Ok(item) = s {
                sessions.push(item);
            }
        }
        Ok(sessions)
    }

    // Change password
    pub fn update_password(&self, user_id: &str, old_pass: &str, new_pass: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let db_hash: String = conn.query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get(0),
        ).map_err(|_| "User not found".to_string())?;

        let parsed_hash = PasswordHash::new(&db_hash).map_err(|e| e.to_string())?;
        Argon2::default()
            .verify_password(old_pass.as_bytes(), &parsed_hash)
            .map_err(|_| "Current password is incorrect.".to_string())?;

        if new_pass.len() < 6 {
            return Err("New password must be at least 6 characters long.".into());
        }

        let salt = SaltString::generate(&mut OsRng);
        let new_hash = Argon2::default()
            .hash_password(new_pass.as_bytes(), &salt)
            .map_err(|e| e.to_string())?
            .to_string();

        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            params![new_hash, user_id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    // Delete account (cascades sessions via foreign key)
    pub fn delete_user(&self, user_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM users WHERE id = ?1", params![user_id])?;
        Ok(())
    }

    // ── Chat CRUD ────────────────────────────────────────────────────────────────

    pub fn create_chat(&self, user_id: &str, title: &str) -> Result<Chat> {
        let id = format!("chat_{}", Uuid::now_v7().simple());
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![&id, user_id, title, &now],
        )?;
        Ok(Chat { id, user_id: user_id.to_string(), title: title.to_string(), created_at: now.clone(), updated_at: now })
    }

    pub fn list_chats(&self, user_id: &str) -> Result<Vec<Chat>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, title, created_at, updated_at FROM chats WHERE user_id = ?1 ORDER BY updated_at DESC"
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(Chat {
                id: row.get(0)?,
                user_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        let mut chats = Vec::new();
        for c in rows { if let Ok(item) = c { chats.push(item); } }
        Ok(chats)
    }

    pub fn get_chat(&self, chat_id: &str, user_id: &str) -> Option<Chat> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, user_id, title, created_at, updated_at FROM chats WHERE id = ?1 AND user_id = ?2",
            params![chat_id, user_id],
            |row| Ok(Chat {
                id: row.get(0)?,
                user_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }),
        ).ok()
    }

    pub fn rename_chat(&self, chat_id: &str, user_id: &str, title: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
            params![title, &now, chat_id, user_id],
        )?;
        Ok(())
    }

    pub fn delete_chat(&self, chat_id: &str, user_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chats WHERE id = ?1 AND user_id = ?2", params![chat_id, user_id])?;
        Ok(())
    }

    // ── Message CRUD ─────────────────────────────────────────────────────────────

    pub fn get_messages(&self, chat_id: &str, user_id: &str) -> Result<Vec<Message>> {
        // Verify ownership first
        {
            let conn = self.conn.lock().unwrap();
            let owned: i64 = conn.query_row(
                "SELECT COUNT(*) FROM chats WHERE id = ?1 AND user_id = ?2",
                params![chat_id, user_id],
                |r| r.get(0),
            ).unwrap_or(0);
            if owned == 0 { return Ok(vec![]); }
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, role, content, created_at, edited_at, position FROM messages WHERE chat_id = ?1 ORDER BY position ASC"
        )?;
        let rows = stmt.query_map(params![chat_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                edited_at: row.get(5)?,
                position: row.get(6)?,
            })
        })?;
        let mut msgs = Vec::new();
        for m in rows { if let Ok(item) = m { msgs.push(item); } }
        Ok(msgs)
    }

    pub fn append_message(&self, chat_id: &str, user_id: &str, role: &str, content: &str) -> Result<Message> {
        let id = format!("msg_{}", Uuid::now_v7().simple());
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        // Verify ownership
        let owned: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chats WHERE id = ?1 AND user_id = ?2",
            params![chat_id, user_id],
            |r| r.get(0),
        ).unwrap_or(0);
        if owned == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        // Get next position
        let pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE chat_id = ?1",
            params![chat_id],
            |r| r.get(0),
        ).unwrap_or(0);
        conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, created_at, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![&id, chat_id, role, content, &now, pos],
        )?;
        // Bump chat updated_at
        conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", params![&now, chat_id])?;
        Ok(Message { id, chat_id: chat_id.to_string(), role: role.to_string(), content: content.to_string(), created_at: now, edited_at: None, position: pos })
    }

    pub fn edit_message(&self, msg_id: &str, chat_id: &str, user_id: &str, content: &str) -> Result<Message> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        // Verify ownership
        let owned: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chats WHERE id = ?1 AND user_id = ?2",
            params![chat_id, user_id],
            |r| r.get(0),
        ).unwrap_or(0);
        if owned == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        // Get current position
        let pos: i64 = conn.query_row(
            "SELECT position FROM messages WHERE id = ?1 AND chat_id = ?2",
            params![msg_id, chat_id],
            |r| r.get(0),
        )?;
        // Delete all messages after this position
        conn.execute("DELETE FROM messages WHERE chat_id = ?1 AND position > ?2", params![chat_id, pos])?;
        // Update the message content
        conn.execute(
            "UPDATE messages SET content = ?1, edited_at = ?2 WHERE id = ?3",
            params![content, &now, msg_id],
        )?;
        conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", params![&now, chat_id])?;
        Ok(Message {
            id: msg_id.to_string(), chat_id: chat_id.to_string(), role: String::new(),
            content: content.to_string(), created_at: now.clone(), edited_at: Some(now), position: pos,
        })
    }

    pub fn delete_single_message(&self, msg_id: &str, chat_id: &str, user_id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        let owned: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chats WHERE id = ?1 AND user_id = ?2",
            params![chat_id, user_id],
            |r| r.get(0),
        ).unwrap_or(0);
        if owned == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        conn.execute("DELETE FROM messages WHERE id = ?1 AND chat_id = ?2", params![msg_id, chat_id])?;
        conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", params![&now, chat_id])?;
        Ok(())
    }

    pub fn delete_message_and_after(&self, msg_id: &str, chat_id: &str, user_id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        let owned: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chats WHERE id = ?1 AND user_id = ?2",
            params![chat_id, user_id],
            |r| r.get(0),
        ).unwrap_or(0);
        if owned == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        let pos: i64 = conn.query_row(
            "SELECT position FROM messages WHERE id = ?1 AND chat_id = ?2",
            params![msg_id, chat_id],
            |r| r.get(0),
        )?;
        conn.execute("DELETE FROM messages WHERE chat_id = ?1 AND position >= ?2", params![chat_id, pos])?;
        conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", params![&now, chat_id])?;
        Ok(())
    }

    pub fn update_chat_title_if_default(&self, chat_id: &str, title: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3 AND title = 'New Conversation'",
            params![title, &now, chat_id],
        )?;
        Ok(())
    }
}
