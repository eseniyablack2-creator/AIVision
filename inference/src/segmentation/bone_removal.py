from __future__ import annotations

import logging

import SimpleITK as sitk

LOGGER = logging.getLogger(__name__)


def rigid_register(fixed: sitk.Image, moving: sitk.Image) -> sitk.Image:
    registration = sitk.ImageRegistrationMethod()
    registration.SetMetricAsMattesMutualInformation(50)
    registration.SetMetricSamplingPercentage(0.2, sitk.ImageRegistrationMethod.RANDOM)
    registration.SetMetricSamplingStrategy(registration.RANDOM)
    registration.SetInterpolator(sitk.sitkLinear)
    registration.SetOptimizerAsRegularStepGradientDescent(
        learningRate=2.0, minStep=1e-4, numberOfIterations=150
    )
    registration.SetOptimizerScalesFromPhysicalShift()
    initial_transform = sitk.CenteredTransformInitializer(
        fixed,
        moving,
        sitk.Euler3DTransform(),
        sitk.CenteredTransformInitializerFilter.GEOMETRY,
    )
    registration.SetInitialTransform(initial_transform, inPlace=False)
    final_transform = registration.Execute(fixed, moving)
    LOGGER.info("Registration metric: %.5f", registration.GetMetricValue())
    return sitk.Resample(
        moving,
        fixed,
        final_transform,
        sitk.sitkLinear,
        -1000.0,
        moving.GetPixelID(),
    )


def create_bone_mask(image: sitk.Image, threshold_hu: float = 300.0) -> sitk.Image:
    return sitk.BinaryThreshold(image, lowerThreshold=threshold_hu, upperThreshold=4096, insideValue=1)


def dilate_mask(mask: sitk.Image, radius_vox: int = 2) -> sitk.Image:
    return sitk.BinaryDilate(mask, [radius_vox] * 3)


def subtract_mask(image: sitk.Image, mask: sitk.Image, outside_value: float = -1000.0) -> sitk.Image:
    return sitk.Mask(image, sitk.Cast(mask, sitk.sitkUInt8), outsideValue=outside_value)


def mmbe_bone_removal(
    contrast_image: sitk.Image, native_image: sitk.Image, threshold_hu: float = 300.0, dilation_vox: int = 2
) -> tuple[sitk.Image, sitk.Image]:
    native_registered = rigid_register(contrast_image, native_image)
    bone_mask = create_bone_mask(native_registered, threshold_hu)
    bone_mask_dilated = dilate_mask(bone_mask, dilation_vox)
    contrast_wo_bones = subtract_mask(contrast_image, bone_mask_dilated, outside_value=-1000.0)
    return contrast_wo_bones, bone_mask_dilated
