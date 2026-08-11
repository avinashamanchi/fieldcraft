require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'FieldCraftSpeech'
  s.version        = package['version']
  s.summary        = 'Private on-device speech recognition for FieldCraft.'
  s.description    = package['description'] || s.summary
  s.license        = 'MIT'
  s.author         = 'FieldCraft'
  s.homepage       = 'https://github.com/avinashamanchi/fieldcraft'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/avinashamanchi/fieldcraft.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation'
  s.source_files = '**/*.{h,m,mm,swift}'
end
