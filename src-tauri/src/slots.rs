use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SlotStatus {
    pub active_users: usize,
    pub max_active_users: usize,
    pub user_holds_slot: bool,
    pub state: String, // "available" | "locked" | "in-use"
}

pub struct SlotManager {
    inner: Mutex<SlotState>,
}

struct SlotState {
    max_active_users: usize,
    // Maps user_id -> Set of active session_ids holding the slot
    // A user with 3 devices only consumes 1 slot!
    user_sessions: HashMap<String, HashSet<String>>,
}

impl SlotManager {
    pub fn new(initial_limit: usize) -> Self {
        Self {
            inner: Mutex::new(SlotState {
                max_active_users: initial_limit,
                user_sessions: HashMap::new(),
            }),
        }
    }

    pub fn set_limit(&self, limit: usize) {
        let mut state = self.inner.lock().unwrap();
        state.max_active_users = limit;
    }

    pub fn get_status(&self, user_id: Option<&str>) -> SlotStatus {
        let state = self.inner.lock().unwrap();
        let active_count = state.user_sessions.len();
        let max_limit = state.max_active_users;

        let user_holds = match user_id {
            Some(uid) => state.user_sessions.contains_key(uid),
            None => false,
        };

        let is_full = active_count >= max_limit;
        let slot_state = if user_holds {
            "in-use".to_string()
        } else if is_full {
            "locked".to_string()
        } else {
            "available".to_string()
        };

        SlotStatus {
            active_users: active_count,
            max_active_users: max_limit,
            user_holds_slot: user_holds,
            state: slot_state,
        }
    }

    /// Claim slot: Enforces hard lockout when limit is reached.
    /// If user is already active (e.g. from another tab), registers session without incrementing active user count.
    pub fn claim_slot(&self, user_id: &str, session_id: &str) -> Result<SlotStatus, String> {
        let mut state = self.inner.lock().unwrap();

        // If the user already holds a slot, add this session to their active session set
        if let Some(sessions) = state.user_sessions.get_mut(user_id) {
            sessions.insert(session_id.to_string());
            return Ok(SlotStatus {
                active_users: state.user_sessions.len(),
                max_active_users: state.max_active_users,
                user_holds_slot: true,
                state: "in-use".to_string(),
            });
        }

        // Hard lockout check: is capacity full?
        if state.user_sessions.len() >= state.max_active_users {
            return Err(format!(
                "Hard Lockout: All {} user slots are currently occupied.",
                state.max_active_users
            ));
        }

        // Claim a new slot for this distinct user
        let mut sessions = HashSet::new();
        sessions.insert(session_id.to_string());
        state.user_sessions.insert(user_id.to_string(), sessions);

        Ok(SlotStatus {
            active_users: state.user_sessions.len(),
            max_active_users: state.max_active_users,
            user_holds_slot: true,
            state: "in-use".to_string(),
        })
    }

    /// Explicit slot release (user unloads model or logs out)
    pub fn release_slot(&self, user_id: &str, session_id: Option<&str>) -> SlotStatus {
        let mut state = self.inner.lock().unwrap();

        if let Some(sess_id) = session_id {
            // Remove session, if that was the user's last session, release the user slot
            if let Some(sessions) = state.user_sessions.get_mut(user_id) {
                sessions.remove(sess_id);
                if sessions.is_empty() {
                    state.user_sessions.remove(user_id);
                }
            }
        } else {
            // Force release all sessions for this user
            state.user_sessions.remove(user_id);
        }

        let active_count = state.user_sessions.len();
        let max_limit = state.max_active_users;
        let user_holds = state.user_sessions.contains_key(user_id);

        SlotStatus {
            active_users: active_count,
            max_active_users: max_limit,
            user_holds_slot: user_holds,
            state: if user_holds { "in-use" } else if active_count >= max_limit { "locked" } else { "available" }.to_string(),
        }
    }

    /// Admin force release
    pub fn force_release(&self, user_id: &str) {
        let mut state = self.inner.lock().unwrap();
        state.user_sessions.remove(user_id);
    }
}
