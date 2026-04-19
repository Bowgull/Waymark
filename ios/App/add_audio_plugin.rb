#!/usr/bin/env ruby
# One-shot: adds WaymarkAudioPlugin.swift to the App target's Sources build
# phase. Safe to re-run — checks for an existing reference before creating.
#
# Sound resources (.caf) don't need registering here: `App/Sounds` is already
# a folder reference in the App target's Resources phase, so any file dropped
# into that directory on disk is auto-bundled. See:
#   pbxproj: `Sounds in Resources` with fileRef lastKnownFileType = folder

require 'xcodeproj'

project_path = File.expand_path('App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'App' }
raise 'App target not found' if app_target.nil?

app_group = project.main_group.find_subpath('App', true)

plugin_filename = 'WaymarkAudioPlugin.swift'
existing_plugin_ref = app_group.files.find { |f| f.path == plugin_filename }

if existing_plugin_ref.nil?
  plugin_ref = app_group.new_file(plugin_filename)
  puts "Added file reference: App/#{plugin_filename}"
else
  plugin_ref = existing_plugin_ref
  puts "File reference already exists: App/#{plugin_filename}"
end

already_in_sources = app_target.source_build_phase.files_references.any? { |r| r == plugin_ref }
if already_in_sources
  puts "Sources phase already has #{plugin_filename}"
else
  app_target.source_build_phase.add_file_reference(plugin_ref)
  puts "Added #{plugin_filename} to App Sources build phase"
end

project.save
puts 'project.pbxproj saved.'
