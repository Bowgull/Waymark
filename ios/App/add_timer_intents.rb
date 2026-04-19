#!/usr/bin/env ruby
# Adds TimerIntents.swift to both the App and WaymarkActivity targets.
# Also links AppIntents.framework to the widget target so LiveActivityIntent compiles.

require 'xcodeproj'

project_path = File.expand_path('App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'App' }
widget_target = project.targets.find { |t| t.name == 'WaymarkActivity' }
raise 'App target not found' if app_target.nil?
raise 'WaymarkActivity target not found' if widget_target.nil?

app_group = project.main_group.find_subpath('App', false)
raise 'App group not found' if app_group.nil?

existing = app_group.files.find { |f| f.path == 'TimerIntents.swift' }
file_ref = existing || app_group.new_reference('TimerIntents.swift')

unless app_target.source_build_phase.files_references.include?(file_ref)
  app_target.add_file_references([file_ref])
  puts 'Added TimerIntents.swift to App target.'
end

unless widget_target.source_build_phase.files_references.include?(file_ref)
  widget_target.add_file_references([file_ref])
  puts 'Added TimerIntents.swift to WaymarkActivity target.'
end

project.save
puts 'Done.'
