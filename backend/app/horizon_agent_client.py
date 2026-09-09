import json
from collections.abc import Awaitable, Mapping, Sequence
from typing import Any
from uuid import uuid4

from agent_framework import (
    BaseChatClient,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
    ResponseStream,
)

from app.repository import ShipmentRepository


def _last_user_text(messages: Sequence[Message]) -> str:
    for message in reversed(messages):
        if message.role == "user" and message.text:
            return message.text
    raise ValueError("Agent Framework request does not contain a user message")


def _function_result_text(messages: Sequence[Message]) -> str | None:
    for message in reversed(messages):
        for content in message.contents:
            if content.type != "function_result":
                continue
            if isinstance(content.result, str):
                return content.result
            if isinstance(content.result, Sequence):
                texts = [
                    item.text
                    for item in content.result
                    if isinstance(item, Content) and item.text
                ]
                if texts:
                    return "\n".join(texts)
            return json.dumps(content.result, default=str)
    return None


class RawHorizonDBChatClient(BaseChatClient[Any]):
    OTEL_PROVIDER_NAME = "azure.horizondb"

    def __init__(
        self,
        repository: ShipmentRepository,
        model_alias: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._repository = repository
        self._model_alias = model_alias

    def service_url(self) -> str:
        return "horizondb://azure_ai"

    def _inner_get_response(
        self,
        *,
        messages: Sequence[Message],
        stream: bool,
        options: Mapping[str, Any],
        **kwargs: Any,
    ) -> Awaitable[ChatResponse] | ResponseStream[ChatResponseUpdate, ChatResponse]:
        del kwargs
        if stream:
            raise ValueError("The HorizonDB Agent Framework client is non-streaming")

        async def _get_response() -> ChatResponse:
            question = _last_user_text(messages)
            tool_result = _function_result_text(messages)
            if tool_result is not None:
                answer = await self._repository.generate_answer(question, tool_result)
                return ChatResponse(
                    messages=Message(role="assistant", contents=[answer]),
                    model=self._model_alias,
                    response_id=f"horizondb-{uuid4().hex}",
                    finish_reason="stop",
                )

            tools = list(options.get("tools") or [])
            if len(tools) != 1:
                raise ValueError("Fleet Intelligence requires exactly one agent tool")
            shipment_tool = tools[0]
            arguments = await self._repository.plan_tool_call(
                question=question,
                tool_name=shipment_tool.name,
                tool_schema=json.dumps(shipment_tool.to_json_schema_spec()),
            )
            return ChatResponse(
                messages=Message(
                    role="assistant",
                    contents=[
                        Content.from_function_call(
                            call_id=f"shipment-search-{uuid4().hex}",
                            name=shipment_tool.name,
                            arguments=arguments,
                        )
                    ],
                ),
                model=self._model_alias,
                response_id=f"horizondb-{uuid4().hex}",
                finish_reason="tool_calls",
            )

        return _get_response()


class HorizonDBChatClient(FunctionInvocationLayer[Any], RawHorizonDBChatClient):
    def __init__(
        self,
        repository: ShipmentRepository,
        model_alias: str,
    ) -> None:
        super().__init__(
            repository=repository,
            model_alias=model_alias,
            function_invocation_configuration={
                "max_iterations": 2,
                "max_function_calls": 1,
            },
        )