use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use crate::db::Database;
use crate::slots::SlotManager;

#[derive(Clone)]
pub struct ServerContext {
    pub db: Arc<Database>,
    pub slots: Arc<SlotManager>,
    pub python_api_port: u16,
    pub dist_dir: PathBuf,
}

#[derive(Deserialize)]
pub struct SetupOwnerPayload {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
    pub device: Option<String>,
}

#[derive(Deserialize)]
pub struct PasswordPayload {
    pub user_id: String,
    pub old_pass: String,
    pub new_pass: String,
}

#[derive(Deserialize)]
pub struct SlotClaimPayload {
    pub user_id: String,
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct SlotLimitPayload {
    pub user_id: String,
    pub limit: u32,
}

#[derive(Deserialize)]
pub struct CreateChatPayload {
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameChatPayload {
    pub title: String,
}

#[derive(Deserialize)]
pub struct AppendMessagePayload {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct EditMessagePayload {
    pub content: String,
}

fn extract_session(headers: &HeaderMap) -> Option<String> {
    headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.replace("Bearer ", "").trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn create_router(ctx: ServerContext) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    let api_routes = Router::new()
        .route("/auth/first-run", get(handle_first_run))
        .route("/auth/setup", post(handle_setup_owner))
        .route("/auth/login", post(handle_login))
        .route("/auth/me", get(handle_get_me))
        .route("/auth/logout", post(handle_logout))
        .route("/auth/password", post(handle_password))
        .route("/auth/sessions/:user_id", get(handle_get_sessions))
        .route("/auth/sessions/revoke/:session_id", post(handle_revoke_session))
        .route("/auth/delete-account/:user_id", post(handle_delete_account))
        .route("/slots/status", get(handle_slot_status))
        .route("/slots/claim", post(handle_slot_claim))
        .route("/slots/release", post(handle_slot_release))
        .route("/slots/limit", post(handle_slot_limit))
        .route("/chats", get(handle_list_chats).post(handle_create_chat))
        .route("/chats/:chat_id", get(handle_get_chat).patch(handle_rename_chat).delete(handle_delete_chat))
        .route("/chats/:chat_id/messages", get(handle_get_messages).post(handle_append_message))
        .route("/chats/:chat_id/messages/:msg_id", patch(handle_edit_message).delete(handle_delete_message))
        .route("/chats/:chat_id/messages/:msg_id/truncate", post(handle_truncate_after));

    let dist_service = ServeDir::new(&ctx.dist_dir);

    Router::new()
        .nest("/api", api_routes)
        // Proxy model & chat endpoints to internal Python engine
        .route("/v1/internal/model/list", get(proxy_to_python_get))
        .route("/v1/internal/model/info", get(proxy_to_python_get))
        .route("/v1/internal/model/load", post(proxy_to_python_post))
        .route("/v1/internal/model/unload", post(proxy_to_python_post))
        .route("/v1/internal/stop-generation", post(proxy_to_python_post))
        .route("/v1/chat/completions", post(proxy_chat_completions))
        .fallback_service(dist_service)
        .layer(cors)
        .with_state(ctx)
}

// Handlers
async fn handle_first_run(State(ctx): State<ServerContext>) -> impl IntoResponse {
    match ctx.db.count_users() {
        Ok(c) => Json(serde_json::json!({ "is_first_run": c == 0 })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn handle_setup_owner(
    State(ctx): State<ServerContext>,
    Json(payload): Json<SetupOwnerPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let count = ctx.db.count_users().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let role = if count == 0 { "owner" } else { "user" };
    let profile = ctx.db.create_user(&payload.username, &payload.password, role)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(profile))
}

async fn handle_login(
    State(ctx): State<ServerContext>,
    Json(payload): Json<LoginPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let dev = payload.device.unwrap_or_else(|| "Web Client".into());
    let (profile, session_id) = ctx.db.login(&payload.username, &payload.password, &dev, "remote")
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    Ok(Json(serde_json::json!({
        "user": profile,
        "session_id": session_id
    })))
}

async fn handle_get_me(
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.replace("Bearer ", "").trim().to_string())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing authorization header".into()))?;

    let profile = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session expired or invalid".into()))?;

    Ok(Json(profile))
}

async fn handle_logout(
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> impl IntoResponse {
    if let Some(token) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        let session_id = token.replace("Bearer ", "").trim().to_string();
        if let Some(user) = ctx.db.get_session_user(&session_id) {
            ctx.slots.release_slot(&user.id, Some(&session_id));
        }
        let _ = ctx.db.delete_session(&session_id);
    }
    StatusCode::OK
}

async fn handle_password(
    State(ctx): State<ServerContext>,
    Json(payload): Json<PasswordPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    ctx.db.update_password(&payload.user_id, &payload.old_pass, &payload.new_pass)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(StatusCode::OK)
}

async fn handle_get_sessions(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.replace("Bearer ", "").trim().to_string())
        .unwrap_or_default();

    let sessions = ctx.db.get_user_sessions(&user_id, &token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(sessions))
}

async fn handle_revoke_session(
    Path(session_id): Path<String>,
    State(ctx): State<ServerContext>,
) -> impl IntoResponse {
    let _ = ctx.db.delete_session(&session_id);
    StatusCode::OK
}

async fn handle_delete_account(
    Path(user_id): Path<String>,
    State(ctx): State<ServerContext>,
) -> impl IntoResponse {
    ctx.slots.release_slot(&user_id, None);
    let _ = ctx.db.delete_user(&user_id);
    StatusCode::OK
}

async fn handle_slot_status(
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> impl IntoResponse {
    let user_id = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            let session_id = v.replace("Bearer ", "").trim().to_string();
            ctx.db.get_session_user(&session_id).map(|u| u.id)
        });

    let status = ctx.slots.get_status(user_id.as_deref());
    Json(status)
}

async fn handle_slot_claim(
    State(ctx): State<ServerContext>,
    Json(payload): Json<SlotClaimPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let status = ctx.slots.claim_slot(&payload.user_id, &payload.session_id)
        .map_err(|e| (StatusCode::CONFLICT, e))?;
    Ok(Json(status))
}

async fn handle_slot_release(
    State(ctx): State<ServerContext>,
    Json(payload): Json<SlotClaimPayload>,
) -> impl IntoResponse {
    let status = ctx.slots.release_slot(&payload.user_id, Some(&payload.session_id));
    Json(status)
}

async fn handle_slot_limit(
    State(ctx): State<ServerContext>,
    Json(payload): Json<SlotLimitPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    ctx.slots.set_limit(payload.limit as usize);
    let _ = ctx.db.set_max_active_users(payload.limit);
    Ok(StatusCode::OK)
}

// ── Chat handlers ────────────────────────────────────────────────────────────

async fn handle_list_chats(
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let chats = ctx.db.list_chats(&user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(chats))
}

async fn handle_create_chat(
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
    Json(payload): Json<CreateChatPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let title = payload.title.unwrap_or_else(|| "New Conversation".to_string());
    let chat = ctx.db.create_chat(&user.id, &title)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(chat))
}

async fn handle_get_chat(
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let chat = ctx.db.get_chat(&chat_id, &user.id)
        .ok_or((StatusCode::NOT_FOUND, "Chat not found".into()))?;
    Ok(Json(chat))
}

async fn handle_rename_chat(
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
    Json(payload): Json<RenameChatPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    ctx.db.rename_chat(&chat_id, &user.id, &payload.title)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::OK)
}

async fn handle_delete_chat(
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    ctx.db.delete_chat(&chat_id, &user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_get_messages(
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let msgs = ctx.db.get_messages(&chat_id, &user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(msgs))
}

async fn handle_append_message(
    Path(chat_id): Path<String>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
    Json(payload): Json<AppendMessagePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let msg = ctx.db.append_message(&chat_id, &user.id, &payload.role, &payload.content)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(msg))
}

async fn handle_edit_message(
    Path((chat_id, msg_id)): Path<(String, String)>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
    Json(payload): Json<EditMessagePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    let msg = ctx.db.edit_message(&msg_id, &chat_id, &user.id, &payload.content)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(msg))
}

async fn handle_delete_message(
    Path((chat_id, msg_id)): Path<(String, String)>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    ctx.db.delete_single_message(&msg_id, &chat_id, &user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn handle_truncate_after(
    Path((chat_id, msg_id)): Path<(String, String)>,
    headers: HeaderMap,
    State(ctx): State<ServerContext>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let token = extract_session(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".into()))?;
    let user = ctx.db.get_session_user(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid".into()))?;
    ctx.db.delete_message_and_after(&msg_id, &chat_id, &user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

// Proxies to local Python engine
async fn proxy_to_python_get(
    State(ctx): State<ServerContext>,
    req: axum::extract::Request,
) -> Response {
    let path = req.uri().path();
    let url = format!("http://127.0.0.1:{}{}", ctx.python_api_port, path);
    match reqwest::get(&url).await {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
            let bytes = res.bytes().await.unwrap_or_default();
            (status, [(axum::http::header::CONTENT_TYPE, "application/json")], bytes).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn proxy_to_python_post(
    State(ctx): State<ServerContext>,
    req: axum::extract::Request,
) -> Response {
    let path = req.uri().path().to_string();
    let url = format!("http://127.0.0.1:{}{}", ctx.python_api_port, path);
    let bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    let client = reqwest::Client::new();
    match client.post(&url).header("Content-Type", "application/json").body(bytes).send().await {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
            let b = res.bytes().await.unwrap_or_default();
            (status, [(axum::http::header::CONTENT_TYPE, "application/json")], b).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn proxy_chat_completions(
    State(ctx): State<ServerContext>,
    req: axum::extract::Request,
) -> Response {
    let url = format!("http://127.0.0.1:{}/v1/chat/completions", ctx.python_api_port);
    let bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    let client = reqwest::Client::new();
    match client.post(&url).header("Content-Type", "application/json").body(bytes).send().await {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
            let content_type = res.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("text/event-stream")
                .to_string();

            let stream = res.bytes_stream();
            let body = axum::body::Body::from_stream(stream);
            Response::builder()
                .status(status)
                .header(axum::http::header::CONTENT_TYPE, content_type)
                .body(body)
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Response building failed").into_response())
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn run_server(addr: SocketAddr, ctx: ServerContext) {
    let app = create_router(ctx);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("Failed to bind Rust HTTP server");
    eprintln!("[sheep-rust-server] listening on http://{}", addr);
    axum::serve(listener, app).await.expect("Rust HTTP server crashed");
}
