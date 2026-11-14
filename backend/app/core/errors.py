"""Structured application errors mapped to HTTP responses by the API layer."""


class GeoMoonError(Exception):
    status_code = 400
    code = "geomoon_error"

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class DataUnavailableError(GeoMoonError):
    """Requested real lunar data is not installed / not covered. Never replaced by fake data."""
    status_code = 404
    code = "data_unavailable"


class OutOfCoverageError(DataUnavailableError):
    code = "out_of_coverage"


class ValidationFailure(GeoMoonError):
    status_code = 422
    code = "validation_failed"


class NotFoundError(GeoMoonError):
    status_code = 404
    code = "not_found"


class ConflictError(GeoMoonError):
    status_code = 409
    code = "conflict"
