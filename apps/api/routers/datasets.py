"""Dataset Status & Fail-Closed V11 Ingest API exposing manifest integrity, split counts, and leakage checks."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from apps.api.models import User
from apps.api.security import get_current_user
from apps.api.training_jobs import training_admin_emails
from apps.core.native.dataset_status import (
    get_dataset_version_status,
    get_datasets_pipeline_status,
    ingest_v11_dataset,
)
from apps.core.native.dataset_v11 import DatasetLeakageError

router = APIRouter(prefix="/v1/datasets", tags=["Datasets"])


class DatasetIngestRequest(BaseModel):
    dataset_version: str = Field(min_length=1, max_length=64)
    source_name: str = Field(min_length=1, max_length=120)
    license: str = Field(min_length=1, max_length=120)
    provenance: str = Field(min_length=1, max_length=200)
    redact_pii: bool = True
    splits: dict[str, list[dict[str, Any]]]


def _require_dataset_admin(current_user: User = Depends(get_current_user)) -> User:
    admins = training_admin_emails()
    if not admins:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Training admin allowlist is not configured.",
        )
    if current_user.email.strip().lower() not in admins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dataset ingestion requires training administrator access.",
        )
    return current_user


@router.get("/status")
def datasets_pipeline_status(
    _: User = Depends(get_current_user),
):
    """Return read-only Dataset Pipeline readiness, active manifest integrity, and version summary."""
    return get_datasets_pipeline_status()


@router.get("/{dataset_version}/status")
def dataset_version_status(
    dataset_version: str,
    _: User = Depends(get_current_user),
):
    """Verify and return status for a specific dataset version under configured dataset storage."""
    try:
        return get_dataset_version_status(dataset_version)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.post("/ingest", status_code=status.HTTP_201_CREATED)
def ingest_dataset_version(
    payload: DatasetIngestRequest,
    _: User = Depends(_require_dataset_admin),
):
    """Ingest a 4-split V11 dataset with required provenance/license, SHA-256 manifest, and leakage gate."""
    try:
        return ingest_v11_dataset(
            dataset_version=payload.dataset_version,
            splits=payload.splits,
            source_name=payload.source_name,
            license_str=payload.license,
            provenance=payload.provenance,
            do_redact_pii=payload.redact_pii,
        )
    except FileExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except (DatasetLeakageError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

