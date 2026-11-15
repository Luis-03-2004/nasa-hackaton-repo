"""Rotas HTTP para o Assistente Contextual com Guardrails e Grounding."""
from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import chat

router = APIRouter(prefix="/chat", tags=["assistant chatbot"])


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatUiContext(BaseModel):
    country: str | None = None
    point_ids: list[str] = Field(default_factory=list, max_length=2000)
    start_date: str = "2000-01-01"
    end_date: str = "2025-12-31"
    reference_date: str = "2025-12-22"
    metric: str = "records"
    resolution: str = "monthly"
    focus_lat: float | None = None
    focus_lon: float | None = None
    user_lat: float | None = None
    user_lon: float | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=600)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=10)
    ui_context: ChatUiContext = Field(default_factory=ChatUiContext)
    locale: Literal["pt-BR", "en"] = "en"


@router.get("/status")
def chat_status():
    has_env_key = bool(chat.resolve_groq_api_key())
    return {
        "status": "ok",
        "provider": "groq" if has_env_key else "local_grounded_fallback",
        "groq_configured_in_env": has_env_key,
        "primary_model": chat.GROQ_PRIMARY_MODEL,
        "fallback_model": chat.GROQ_FALLBACK_MODEL,
        "guardrails": ["layer1_input_regex", "layer2_scope_enforcement", "layer3_sqlite_grounding"],
    }


@router.post("")
def post_chat(body: ChatRequest) -> dict[str, Any]:
    # Camada 1: Guardrail rápido em Python
    precheck = chat.guardrails_precheck(body.message, body.locale)
    if precheck and precheck.get("blocked"):
        return {
            "reply": precheck["reply"],
            "model": "guardrail:layer1",
            "blocked": True,
            "tools_used": [],
        }

    ui_dict = body.ui_context.model_dump()
    intent, grounding_data = chat.gather_grounding_context(
        message=body.message,
        ui_context=ui_dict,
        locale=body.locale,
    )
    tools_used = [item.get("tool", "unknown") for item in grounding_data]

    # Camada 2 & 3: Chamada Groq com System Prompt restritivo + Grounding JSON
    history_dicts = [h.model_dump() for h in body.history]
    reply, model_used = chat.call_groq_chat(
        message=body.message,
        history=history_dicts,
        ui_context=ui_dict,
        grounding_data=grounding_data,
        locale=body.locale,
    )

    if reply is None:
        reply = chat.build_local_grounded_reply(
            message=body.message,
            ui_context=ui_dict,
            grounding_data=grounding_data,
            locale=body.locale,
            reason=model_used,
        )
        model_used = f"local_grounded ({model_used})"

    return {
        "reply": reply,
        "model": model_used,
        "blocked": False,
        "intent": intent,
        "tools_used": tools_used,
    }
