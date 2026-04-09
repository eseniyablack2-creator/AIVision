from __future__ import annotations

import logging
from pathlib import Path

import pydicom
import SimpleITK as sitk

LOGGER = logging.getLogger(__name__)


class DicomLoader:
    def discover_series(self, input_dir: str | Path) -> list[str]:
        directory = Path(input_dir)
        if not directory.exists():
            raise FileNotFoundError(f"DICOM directory not found: {directory}")
        series_ids = sitk.ImageSeriesReader.GetGDCMSeriesIDs(str(directory)) or []
        return list(series_ids)

    def load_series(self, input_dir: str | Path, series_id: str | None = None) -> sitk.Image:
        directory = Path(input_dir)
        if series_id is None:
            series_ids = self.discover_series(directory)
            if not series_ids:
                raise ValueError(f"No DICOM series found in {directory}")
            series_id = series_ids[0]
        files = sitk.ImageSeriesReader.GetGDCMSeriesFileNames(str(directory), series_id)
        if not files:
            raise ValueError(f"No files found for series {series_id} in {directory}")
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames(files)
        image = reader.Execute()
        LOGGER.info("Loaded series %s with %d slices", series_id, len(files))
        return image

    def read_metadata_sample(self, input_dir: str | Path) -> dict[str, str]:
        directory = Path(input_dir)
        first_file = next(directory.rglob("*.dcm"), None)
        if first_file is None:
            return {}
        ds = pydicom.dcmread(str(first_file), stop_before_pixels=True, force=True)
        return {
            "PatientID": str(getattr(ds, "PatientID", "")),
            "StudyDate": str(getattr(ds, "StudyDate", "")),
            "SeriesDescription": str(getattr(ds, "SeriesDescription", "")),
            "Modality": str(getattr(ds, "Modality", "")),
        }
