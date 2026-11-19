use std::sync::Arc;
use tauri::State;
use crate::db::{Database, UserProfile, UserSession};
use crate::slots::{SlotManager, SlotStatus};

pub struct AppState {
    pub db: Arc<Database>,
    pub slots: Arc<SlotManager>,
}

#[tauri::command]
pub fn check_first_run(state: State<'_, AppState>) -> Result<bool, String> {
    state.db.count_users().map(|c| c == 0).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn setup_owner(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<UserProfile, String> {
    let count = state.db.count_users().map_err(|e| e.to_string())?;
    let role = if count == 0 { "owner" } else { "user" };
    state.db.create_user(&username, &password, role)
}

#[tauri::command]
pub fn login(
    username: String,
    password: String,
    device: Option<String>,
    state: State<'_, AppState>,
) -> Result<(UserProfile, String), String> {
    let dev = device.unwrap_or_else(|| "Desktop Window".into());
    state.db.login(&username, &password, &dev, "127.0.0.1")
}

#[tauri::command]
pub fn get_current_user(session_id: String, state: State<'_, AppState>) -> Result<Option<UserProfile>, String> {
    Ok(state.db.get_session_user(&session_id))
}

#[tauri::command]
pub fn logout(session_id: String, user_id: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(uid) = user_id {
        state.slots.release_slot(&uid, Some(&session_id));
    }
    state.db.delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_user_sessions(user_id: String, current_session: String, state: State<'_, AppState>) -> Result<Vec<UserSession>, String> {
    state.db.get_user_sessions(&user_id, &current_session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn revoke_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_password(user_id: String, old_pass: String, new_pass: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.update_password(&user_id, &old_pass, &new_pass)
}

#[tauri::command]
pub fn delete_account(user_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.slots.release_slot(&user_id, None);
    state.db.delete_user(&user_id).map_err(|e| e.to_string())
}

// Slot Management Commands
#[tauri::command]
pub fn get_slot_status(user_id: Option<String>, state: State<'_, AppState>) -> SlotStatus {
    state.slots.get_status(user_id.as_deref())
}

#[tauri::command]
pub fn claim_slot(user_id: String, session_id: String, state: State<'_, AppState>) -> Result<SlotStatus, String> {
    state.slots.claim_slot(&user_id, &session_id)
}

#[tauri::command]
pub fn release_slot(user_id: String, session_id: Option<String>, state: State<'_, AppState>) -> SlotStatus {
    state.slots.release_slot(&user_id, session_id.as_deref())
}

#[tauri::command]
pub fn admin_force_release(user_id: String, caller_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(caller) = state.db.get_session_user(&caller_id) {
        if caller.role != "owner" {
            return Err("Only the server owner can force release a slot.".into());
        }
    }
    state.slots.force_release(&user_id);
    Ok(())
}

#[tauri::command]
pub fn set_max_active_users(limit: u32, user_id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Verify caller is owner
    let conn_user = state.db.get_session_user(&user_id);
    if let Some(u) = conn_user {
        if u.role != "owner" {
            return Err("Only the server owner can change capacity limits.".into());
        }
    }
    state.slots.set_limit(limit as usize);
    state.db.set_max_active_users(limit).map_err(|e| e.to_string())?;
    Ok(())
}
